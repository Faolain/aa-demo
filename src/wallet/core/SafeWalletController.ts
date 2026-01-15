import Safe, {
  PREDETERMINED_SALT_NONCE,
  SafeProvider,
  encodeMultiSendData,
  getMultiSendContract,
  predictSafeAddress,
} from '@safe-global/protocol-kit'
import type {
  PasskeyClient,
  SafeAccountConfig,
  SafeDeploymentConfig,
  SafeProviderConfig,
  SafeProviderInitOptions,
} from '@safe-global/protocol-kit'
import {
  Safe4337Pack,
  createBundlerClient,
  userOperationToHexValues,
  type UserOperationReceipt,
} from '@safe-global/relay-kit'
import { OperationType, type MetaTransactionData } from '@safe-global/types-kit'
import {
  createPublicClient,
  encodePacked,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type PublicClient,
} from 'viem'

import { BestEffortFeeEstimator, BundlerClient } from '../bundler'
import { buildContractNetworks } from '../chain'
import { SAFE_VERSION, ZERO_ADDRESS } from '../constants'
import {
  buildPaymasterStatus,
  resolveCirclePaymasterOptions,
  resolveSponsorPaymasterOptions,
  type PaymasterOverrides,
} from '../paymasters'
import { RpcClient } from '../rpc'
import {
  ERC7579_ACCOUNT_ABI,
  SENTINEL_ADDRESS,
  SOCIAL_RECOVERY_ABI,
  SOCIAL_RECOVERY_MODULE_ADDRESS,
  buildAddSocialRecoveryGuardianCall,
  buildInstallSocialRecoveryModuleCall,
  buildRemoveSocialRecoveryGuardianCall,
  buildSetSocialRecoveryThresholdCall,
  encodeGuardianSignatures,
  encodeValidatorNonce,
  normalizeGuardianList,
} from '../recovery'
import { createPasskeyMetadata, isValidPasskeyMetadata, resolvePasskeySigner } from '../signers'
import { getWalletState, setChainOverrides, updateWalletState } from '../storage'
import type { WalletOwnerConfig, WalletState, WalletStatePayload } from '../storage'
import type {
  BundlerEndpoint,
  Call,
  ChainConfig,
  HexAddress,
  HexData,
  ModuleAllowlistEntry,
  PasskeyMetadata,
  PaymasterMode,
  PaymasterStatus,
  ReceiptPollingOptions,
  RecoveryConfig,
  RecoveryExecution,
  Safe4337PaymasterOptions,
  TxResult,
  UserOpResult,
} from '../types'
import type { SendCallsOptions, WalletController } from './WalletController'
import {
  buildSafe4337ModuleSetupCall,
  resolveSafe4337FallbackHandler,
  resolveSafe4337ModuleAddress,
} from './safe4337'

export type SafeWalletControllerOptions = {
  chain: ChainConfig
  provider: unknown
  signer: unknown
  safeAddress?: HexAddress
  safeModulesVersion?: string
  safeVersion?: SafeProviderInitOptions['safeVersion']
  bundlerEndpoints?: BundlerEndpoint[]
  paymasterOptions?: Safe4337PaymasterOptions
  paymasterOverrides?: PaymasterOverrides
  enableSponsoredPaymaster?: boolean
  ownerConfigOverride?: WalletOwnerConfig
}

const buildTransactions = (calls: Call[]) =>
  calls.map((call) => ({
    to: call.to,
    data: call.data ?? '0x',
    value: (call.value ?? 0n).toString(),
  }))

const resolveBundlerUrls = (
  chain: ChainConfig,
  endpoints?: BundlerEndpoint[],
): string[] => {
  if (endpoints && endpoints.length > 0) {
    return endpoints.map((endpoint) => endpoint.url)
  }

  return chain.bundlerUrls ?? []
}

type Safe4337InitParams = Parameters<typeof Safe4337Pack.init>[0]

const DEFAULT_THRESHOLD = 1
const ADD_OWNER_ABI = parseAbi(['function addOwnerWithThreshold(address owner,uint256 threshold)'])
const SAFE_ENABLE_MODULE_ABI = parseAbi(['function enableModule(address module)'])
const ERC20_APPROVE_ABI = parseAbi(['function approve(address spender,uint256 amount)'])
const ERC20_BALANCE_OF_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)'])
const MULTI_SEND_ABI = parseAbi(['function multiSend(bytes transactions)'])
const LOCAL_ESTIMATE_CALL_GAS_LIMIT = 1_500_000n
const LOCAL_ESTIMATE_VERIFICATION_GAS_LIMIT = 1_500_000n
const LOCAL_ESTIMATE_PRE_VERIFICATION_GAS = 200_000n
const LOCAL_ESTIMATE_PAYMASTER_GAS_LIMIT = 200_000n
const MAX_ERC20_APPROVAL = (1n << 256n) - 1n

export class SafeWalletController implements WalletController {
  private readonly chain: ChainConfig
  private readonly provider: unknown
  private readonly signer: unknown
  private readonly safeVersion: SafeProviderInitOptions['safeVersion']
  private safeAddress?: HexAddress
  private paymasterOptions?: Safe4337PaymasterOptions
  private readonly paymasterOverrides?: PaymasterOverrides
  private paymasterMode: PaymasterMode = 'auto'
  private lastPaymasterStatus?: PaymasterStatus
  private readonly enableSponsoredPaymaster: boolean
  private readonly ownerConfigOverride?: WalletOwnerConfig
  private bundlerUrls: string[]
  private bundlerCursor = 0
  private bundlerClient?: BundlerClient
  private rpcUrls: string[]
  private rpcClient?: RpcClient
  private lastBundlerUrl?: string

  constructor(options: SafeWalletControllerOptions) {
    this.chain = options.chain
    this.provider = options.provider
    this.signer = options.signer
    this.safeVersion = options.safeVersion ?? SAFE_VERSION
    this.safeAddress = options.safeAddress
    this.paymasterOptions = options.paymasterOptions
    this.paymasterOverrides = options.paymasterOverrides ?? (options.paymasterOptions ? { circle: options.paymasterOptions } : undefined)
    this.enableSponsoredPaymaster = options.enableSponsoredPaymaster ?? false
    this.ownerConfigOverride = options.ownerConfigOverride
    this.bundlerUrls = resolveBundlerUrls(options.chain, options.bundlerEndpoints)
    this.rpcUrls = options.chain.rpcUrls

    const bundlerEndpoints = options.bundlerEndpoints ?? this.bundlerUrls
    if (bundlerEndpoints.length > 0) {
      this.bundlerClient = new BundlerClient({ endpoints: bundlerEndpoints })
    }

    if (this.rpcUrls.length > 0) {
      this.rpcClient = new RpcClient({ urls: this.rpcUrls })
    }
  }

  async createPasskeySigner(): Promise<PasskeyMetadata> {
    const passkeyMetadata = await createPasskeyMetadata()
    let passkeyInfo: Awaited<ReturnType<typeof resolvePasskeySigner>> | null = null
    try {
      passkeyInfo = await resolvePasskeySigner({
        chain: this.chain,
        provider: this.provider as SafeProviderConfig['provider'],
        passkey: passkeyMetadata,
        safeVersion: this.safeVersion,
      })
    } catch (error) {
      console.warn(
        '[SafeWalletController] Passkey signer resolution failed; retry after RPC is available.',
        error,
      )
    }

    await updateWalletState((current) => {
      const hasPasskey = current.passkeys.some((item) => item.rawId === passkeyMetadata.rawId)
      const passkeys = hasPasskey ? current.passkeys : [...current.passkeys, passkeyMetadata]
      if (!passkeyInfo) {
        return {
          ...current,
          passkeys,
        }
      }

      const ownerConfig = current.ownerConfig ?? { owners: [], threshold: DEFAULT_THRESHOLD }
      const owners = ownerConfig.owners.includes(passkeyInfo.address)
        ? ownerConfig.owners
        : [...ownerConfig.owners, passkeyInfo.address]
      const threshold = ownerConfig.threshold || DEFAULT_THRESHOLD

      return {
        ...current,
        passkeys,
        ownerConfig: {
          owners,
          threshold,
        },
      }
    })

    return passkeyMetadata
  }

  async addPasskeyOwner(passkey: PasskeyMetadata): Promise<TxResult> {
    const safeAddress = this.requireSafeAddress()
    await this.ensureSafeDeployed(safeAddress)

    const walletState = await getWalletState()
    const ownerConfig = walletState?.ownerConfig
    const owners = ownerConfig?.owners ?? []
    const threshold = ownerConfig?.threshold ?? DEFAULT_THRESHOLD

    const passkeyInfo = await resolvePasskeySigner({
      chain: this.chain,
      provider: this.provider as SafeProviderConfig['provider'],
      passkey,
      safeVersion: this.safeVersion,
      safeAddress,
      owners,
    })

    if (owners.includes(passkeyInfo.address)) {
      throw new Error('Passkey owner already added')
    }

    const transactions: Call[] = [
      {
        to: safeAddress,
        data: encodeFunctionData({
          abi: ADD_OWNER_ABI,
          functionName: 'addOwnerWithThreshold',
          args: [passkeyInfo.address, BigInt(threshold)],
        }),
      },
    ]

    const signerDeployed = await passkeyInfo.safeProvider.isContractDeployed(passkeyInfo.address)
    if (!signerDeployed) {
      const deployment = passkeyInfo.signer.createDeployTxRequest()
      transactions.push({
        to: deployment.to as HexAddress,
        data: deployment.data as HexData,
        value: deployment.value ? BigInt(deployment.value) : 0n,
      })
    }

    const result = await this.sendCalls(transactions)

    await updateWalletState((current) => {
      const hasPasskey = current.passkeys.some((item) => item.rawId === passkey.rawId)
      const passkeys = hasPasskey ? current.passkeys : [...current.passkeys, passkey]
      const nextOwners = [...owners, passkeyInfo.address]

      return {
        ...current,
        passkeys,
        ownerConfig: {
          owners: nextOwners,
          threshold,
        },
      }
    })

    return result
  }

  async addPortableOwner(ownerAddress: HexAddress): Promise<TxResult> {
    const safeAddress = this.requireSafeAddress()
    await this.ensureSafeDeployed(safeAddress)

    const walletState = await getWalletState()
    const ownerConfig = walletState?.ownerConfig
    const owners = ownerConfig?.owners ?? []
    const threshold = ownerConfig?.threshold ?? DEFAULT_THRESHOLD
    const normalizedOwner = getAddress(ownerAddress) as HexAddress

    if (owners.includes(normalizedOwner)) {
      throw new Error('Portable owner already added')
    }

    const result = await this.sendCalls([
      {
        to: safeAddress,
        data: encodeFunctionData({
          abi: ADD_OWNER_ABI,
          functionName: 'addOwnerWithThreshold',
          args: [normalizedOwner, BigInt(threshold)],
        }),
      },
    ])

    await updateWalletState((current) => ({
      ...current,
      ownerConfig: {
        owners: [...owners, normalizedOwner],
        threshold,
      },
    }))

    return result
  }

  async getCounterfactualAddress(): Promise<HexAddress> {
    const walletState = await this.ensurePasskeyOwnerConfig(await getWalletState())
    const resolvedState = walletState ?? this.buildFallbackWalletState()
    const ownerConfig = this.ownerConfigOverride ?? resolvedState.ownerConfig
    if (!ownerConfig) {
      throw new Error('Owner config is required to predict Safe address')
    }

    const requestedMode = this.paymasterMode
    const candidateModes = this.getPaymasterModePlan(requestedMode)
    const bundlerUrls = this.getBundlerUrls()
    const bundlerUrl = bundlerUrls[this.bundlerCursor] ?? bundlerUrls[0]
    let rpcUrl: string | undefined
    try {
      rpcUrl = await this.selectRpcUrl()
    } catch {
      rpcUrl = undefined
    }
    let fallbackReason: string | undefined

    const stateForPaymaster = walletState ?? resolvedState
    for (const mode of candidateModes) {
      const resolution = await this.resolvePaymasterOptionsForMode({
        mode,
        bundlerUrl,
        rpcUrl,
        walletState: stateForPaymaster,
        requestedMode,
      })

      if (!resolution.available) {
        if (resolution.reportAsFallback && resolution.reason) {
          fallbackReason = resolution.reason
        }
        continue
      }

      this.paymasterOptions = resolution.options
      this.lastPaymasterStatus = buildPaymasterStatus({
        requestedMode,
        resolvedMode: mode,
        fallbackReason,
        paymasterUrl: resolution.options?.paymasterUrl,
      })
      break
    }

    const chainKey = String(this.chain.chainId)
    const chainState = walletState?.chainState?.[chainKey]
    const predictedConfig = await this.buildPredictedSafeConfig(resolvedState, this.paymasterOptions)
    const { safeProvider, safeAccountConfig, safeDeploymentConfig, configHash } = predictedConfig

    if (!this.ownerConfigOverride && chainState?.configHash && !chainState.deployed && chainState.configHash !== configHash) {
      throw new Error('Counterfactual config changed; explicit confirmation is required')
    }

    if (!this.ownerConfigOverride && chainState?.predictedAddress && chainState.configHash === configHash) {
      this.safeAddress = chainState.predictedAddress
      return chainState.predictedAddress
    }

    const predictedAddress = (await predictSafeAddress({
      safeProvider,
      chainId: BigInt(this.chain.chainId),
      safeAccountConfig,
      safeDeploymentConfig,
      customContracts: {
        safeProxyFactoryAddress: this.chain.safeProxyFactory,
        safeSingletonAddress: this.chain.safeSingleton,
      },
    })) as HexAddress

    if (!this.ownerConfigOverride) {
      await updateWalletState((current) => ({
        ...current,
        chainState: {
          ...current.chainState,
          [chainKey]: {
            ...current.chainState[chainKey],
            predictedAddress,
            configHash,
          },
        },
        deploymentConfigByChain: {
          ...current.deploymentConfigByChain,
          [chainKey]: {
            saltNonce: predictedConfig.saltNonce,
          },
        },
      }))
    }

    this.safeAddress = predictedAddress
    return predictedAddress
  }

  async isDeployed(): Promise<boolean> {
    const address = await this.getCounterfactualAddress()
    let code: HexData = '0x'

    if (this.rpcClient) {
      try {
        code = await this.rpcClient.getCode(address)
      } catch {
        // Fall back to SafeProvider if the RPC fallback client fails.
      }
    }

    if (code === '0x') {
      const safeProvider = new SafeProvider({
        provider: this.provider as SafeProviderConfig['provider'],
      })
      code = (await safeProvider.getContractCode(address)) as HexData
    }
    const deployed = code !== '0x'
    const chainKey = String(this.chain.chainId)

    await updateWalletState((current) => ({
      ...current,
      chainState: {
        ...current.chainState,
        [chainKey]: {
          ...current.chainState[chainKey],
          deployed,
          lastCheckedAt: new Date().toISOString(),
        },
      },
    }))

    return deployed
  }

  private async isSafeAddressDeployed(address: HexAddress): Promise<boolean> {
    let code: HexData = '0x'

    if (this.rpcClient) {
      try {
        code = await this.rpcClient.getCode(address)
      } catch {
        // Fall back to SafeProvider if the RPC fallback client fails.
      }
    }

    if (code === '0x') {
      const safeProvider = new SafeProvider({
        provider: this.provider as SafeProviderConfig['provider'],
      })
      code = (await safeProvider.getContractCode(address)) as HexData
    }

    const deployed = code !== '0x'
    const chainKey = String(this.chain.chainId)

    await updateWalletState((current) => ({
      ...current,
      chainState: {
        ...current.chainState,
        [chainKey]: {
          ...current.chainState[chainKey],
          deployed,
          lastCheckedAt: new Date().toISOString(),
        },
      },
    }))

    return deployed
  }

  async sendCalls(calls: Call[], options: SendCallsOptions = {}): Promise<UserOpResult> {
    const bundlerUrls = this.getBundlerUrls()
    const rpcUrl = await this.selectRpcUrl()
    let lastError: unknown

    if (bundlerUrls.length === 0) {
      throw new Error('No bundler endpoints configured')
    }

    if (!rpcUrl) {
      throw new Error('No RPC endpoint configured')
    }

    const walletState = await getWalletState()
    const requestedMode = this.paymasterMode

    for (let attempt = 0; attempt < bundlerUrls.length; attempt += 1) {
      const bundlerUrl = await this.selectBundlerUrl(attempt)
      const candidateModes = this.getPaymasterModePlan(requestedMode)
      let fallbackReason: string | undefined

      for (const mode of candidateModes) {
        const resolution = await this.resolvePaymasterOptionsForMode({
          mode,
          bundlerUrl,
          rpcUrl,
          walletState,
          requestedMode,
        })

        if (!resolution.available) {
          if (resolution.reportAsFallback && resolution.reason) {
            fallbackReason = resolution.reason
          }
          continue
        }

        const paymasterOptions = resolution.options
        const paymasterStatus = buildPaymasterStatus({
          requestedMode,
          resolvedMode: mode,
          fallbackReason,
          paymasterUrl: paymasterOptions?.paymasterUrl,
        })

        try {
          const safe4337Pack = await this.initSafe4337Pack(bundlerUrl, paymasterOptions)
          const protocolKit = safe4337Pack.protocolKit
          const safeAddress = (await protocolKit.getAddress()) as HexAddress
          const isDeployed = await protocolKit.isSafeDeployed()
          const deploymentCalls = isDeployed
            ? []
            : this.buildDeploymentCalls(safeAddress, options)
          const transactions = buildTransactions([...deploymentCalls, ...calls])
          this.safeAddress ??= safeAddress
          const safeOperation = await safe4337Pack.createTransaction({
            transactions,
            options: {
              feeEstimator: new BestEffortFeeEstimator(rpcUrl, bundlerUrl),
            },
          })
          const signedOperation = await safe4337Pack.signSafeOperation(safeOperation)
          const userOpHash = (await safe4337Pack.executeTransaction({
            executable: signedOperation,
          })) as HexData

          this.bundlerCursor = (this.bundlerCursor + attempt) % bundlerUrls.length
          this.lastBundlerUrl = bundlerUrl
          this.bundlerClient?.markEndpointHealthy(bundlerUrl)
          this.paymasterOptions = paymasterOptions
          this.lastPaymasterStatus = paymasterStatus
          return { chainId: this.chain.chainId, userOpHash, paymasterStatus }
        } catch (error) {
          lastError = error
          if (mode !== 'native') {
            fallbackReason = this.formatPaymasterFailure(mode, error)
            continue
          }
        }

        break
      }

      if (this.bundlerClient) {
        this.bundlerClient.markEndpointFailure(bundlerUrl, lastError)
      }
    }

    throw lastError ?? new Error('Failed to submit user operation')
  }

  async getUserOperationReceipt(userOpHash: HexData): Promise<UserOperationReceipt | null> {
    const bundlerUrl = this.lastBundlerUrl ?? this.getBundlerUrls()[this.bundlerCursor]
    if (!bundlerUrl) {
      throw new Error('No bundler endpoints configured')
    }

    const safe4337Pack = await this.initSafe4337Pack(bundlerUrl)
    return safe4337Pack.getUserOperationReceipt(userOpHash)
  }

  async waitForUserOperationReceipt(
    userOpHash: HexData,
    options: ReceiptPollingOptions = {},
  ): Promise<UserOperationReceipt> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const pollIntervalMs = options.pollIntervalMs ?? 4_000
    const startedAt = Date.now()
    let lastError: unknown

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const receipt = await this.getUserOperationReceipt(userOpHash)
        if (receipt) {
          if (receipt.success && this.safeAddress) {
            await updateWalletState((current) => {
              const chainKey = String(this.chain.chainId)
              return {
                ...current,
                chainState: {
                  ...current.chainState,
                  [chainKey]: {
                    ...current.chainState[chainKey],
                    deployed: true,
                    lastCheckedAt: new Date().toISOString(),
                  },
                },
              }
            })
          }
          return receipt
        }
      } catch (error) {
        lastError = error
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    throw lastError ?? new Error('Timed out waiting for UserOperation receipt')
  }

  setPaymasterMode(mode: PaymasterMode): void {
    this.paymasterMode = mode
    this.lastPaymasterStatus = undefined
    this.paymasterOptions = undefined
  }

  getPaymasterStatus(): PaymasterStatus | undefined {
    return this.lastPaymasterStatus
  }

  setBundlerEndpoints(endpoints: BundlerEndpoint[]): void {
    this.bundlerUrls = resolveBundlerUrls(this.chain, endpoints)
    this.bundlerCursor = 0
    this.bundlerClient = endpoints.length > 0 ? new BundlerClient({ endpoints }) : undefined
    void setChainOverrides({
      chainId: this.chain.chainId,
      overrides: {
        bundlerUrls: this.bundlerUrls,
        rpcUrls: this.rpcUrls,
      },
    })
  }

  setRpcUrls(urls: string[]): void {
    this.rpcUrls = urls
    this.rpcClient = urls.length > 0 ? new RpcClient({ urls }) : undefined
    void setChainOverrides({
      chainId: this.chain.chainId,
      overrides: {
        bundlerUrls: this.getBundlerUrls(),
        rpcUrls: urls,
      },
    })
  }

  async setupRecovery(config: RecoveryConfig): Promise<TxResult> {
    const safeAddress = this.safeAddress ?? (await this.getCounterfactualAddress())
    const guardians = normalizeGuardianList(config.guardians)
    const threshold = config.threshold

    if (guardians.length < 2) {
      throw new Error('Recovery requires at least 2 guardians')
    }

    if (threshold <= 0 || threshold > guardians.length) {
      throw new Error('Recovery threshold must be between 1 and guardian count')
    }

    if (!this.chain.safe7579Adapter || this.chain.safe7579Adapter === ZERO_ADDRESS) {
      throw new Error('Safe7579 adapter address is required for recovery modules')
    }

    const moduleAddress = this.resolveRecoveryModuleAddress(config.moduleAddress)
    const rpcUrl = await this.selectRpcUrl()
    if (!rpcUrl) {
      throw new Error('No RPC endpoint configured')
    }

    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    await this.assertModuleAllowed({
      moduleAddress,
      allowUnsafe: config.allowUnsafeModule,
      publicClient,
    })

    let isInstalled = false
    try {
      isInstalled = await publicClient.readContract({
        address: safeAddress,
        abi: ERC7579_ACCOUNT_ABI,
        functionName: 'isModuleInstalled',
        args: [1n, moduleAddress, '0x'],
      })
    } catch {
      isInstalled = false
    }

    const calls: Call[] = []

    if (!isInstalled) {
      calls.push(
        buildInstallSocialRecoveryModuleCall({
          safeAddress,
          moduleAddress,
          guardians,
          threshold,
        }),
      )
    }

    if (isInstalled) {
      const [currentGuardians, currentThreshold] = await Promise.all([
        this.fetchSocialRecoveryGuardians(publicClient, safeAddress, moduleAddress),
        this.fetchSocialRecoveryThreshold(publicClient, safeAddress, moduleAddress),
      ])
      const currentGuardianSet = new Set(currentGuardians.map((guardian) => guardian.toLowerCase()))
      const nextGuardianSet = new Set(guardians.map((guardian) => guardian.toLowerCase()))

      if (currentThreshold !== null && currentThreshold > threshold) {
        calls.push(buildSetSocialRecoveryThresholdCall(moduleAddress, threshold))
      }

      for (const guardian of guardians) {
        if (!currentGuardianSet.has(guardian.toLowerCase())) {
          calls.push(buildAddSocialRecoveryGuardianCall(moduleAddress, guardian))
        }
      }

      const workingGuardians = [...currentGuardians]
      for (const guardian of currentGuardians) {
        if (nextGuardianSet.has(guardian.toLowerCase())) {
          continue
        }

        const index = workingGuardians.findIndex(
          (candidate) => candidate.toLowerCase() === guardian.toLowerCase(),
        )
        if (index === -1) {
          continue
        }

        const prevGuardian = index === 0 ? SENTINEL_ADDRESS : workingGuardians[index - 1]
        calls.push(buildRemoveSocialRecoveryGuardianCall(moduleAddress, prevGuardian, guardian))
        workingGuardians.splice(index, 1)
      }

      if (currentThreshold !== null && currentThreshold < threshold) {
        calls.push(buildSetSocialRecoveryThresholdCall(moduleAddress, threshold))
      }
    }

    if (calls.length === 0) {
      return { chainId: this.chain.chainId }
    }

    const result = await this.sendCalls(calls)
    await updateWalletState((current) => ({
      ...current,
      recovery: {
        guardians,
        threshold,
        moduleAddress,
      },
    }))

    return result
  }

  async recover(config: RecoveryExecution): Promise<UserOpResult> {
    const safeAddress = this.safeAddress ?? (await this.getCounterfactualAddress())
    const newOwners = normalizeGuardianList(config.newOwners)
    const newThreshold = config.newThreshold

    if (newOwners.length === 0) {
      throw new Error('Recovery requires at least one owner')
    }

    if (newThreshold <= 0 || newThreshold > newOwners.length) {
      throw new Error('Owner threshold must be between 1 and owner count')
    }

    const guardianSignatures = config.guardianSignatures
    if (!guardianSignatures || guardianSignatures.length === 0) {
      const calls = await this.buildOwnerRotationCalls({ owners: newOwners, threshold: newThreshold })
      const result = await this.sendCalls(calls)
      await this.persistRecoveredOwners(newOwners, newThreshold)
      return result
    }

    if (!this.chain.safe7579Adapter || this.chain.safe7579Adapter === ZERO_ADDRESS) {
      throw new Error('Safe7579 adapter address is required for recovery modules')
    }

    const walletState = await getWalletState()
    const guardianThreshold = config.guardianThreshold ?? walletState?.recovery?.threshold
    if (!guardianThreshold) {
      throw new Error('Guardian threshold is required to execute recovery')
    }

    const moduleAddress = this.resolveRecoveryModuleAddress(
      config.moduleAddress ?? walletState?.recovery?.moduleAddress,
    )

    const bundlerUrls = this.getBundlerUrls()
    const rpcUrl = await this.selectRpcUrl()
    let lastError: unknown

    if (bundlerUrls.length === 0) {
      throw new Error('No bundler endpoints configured')
    }

    if (!rpcUrl) {
      throw new Error('No RPC endpoint configured')
    }

    const publicClient = createPublicClient({ transport: http(rpcUrl) })
    await this.assertModuleAllowed({
      moduleAddress,
      allowUnsafe: config.allowUnsafeModule,
      publicClient,
    })

    const isInstalled = await this.isSocialRecoveryInstalled(publicClient, safeAddress, moduleAddress)
    if (!isInstalled) {
      throw new Error('Social recovery module is not installed on this Safe')
    }

    const requestedMode = this.paymasterMode
    const calls = await this.buildOwnerRotationCalls({ owners: newOwners, threshold: newThreshold })

    for (let attempt = 0; attempt < bundlerUrls.length; attempt += 1) {
      const bundlerUrl = await this.selectBundlerUrl(attempt)
      const candidateModes = this.getPaymasterModePlan(requestedMode)
      let fallbackReason: string | undefined

      for (const mode of candidateModes) {
        const resolution = await this.resolvePaymasterOptionsForMode({
          mode,
          bundlerUrl,
          rpcUrl,
          walletState,
          requestedMode,
        })

        if (!resolution.available) {
          if (resolution.reportAsFallback && resolution.reason) {
            fallbackReason = resolution.reason
          }
          continue
        }

        const paymasterOptions = resolution.options
        const paymasterStatus = buildPaymasterStatus({
          requestedMode,
          resolvedMode: mode,
          fallbackReason,
          paymasterUrl: paymasterOptions?.paymasterUrl,
        })

        try {
          const safe4337Pack = await this.initSafe4337Pack(bundlerUrl, paymasterOptions)
          const transactions = buildTransactions(calls)
          const safeOperation = await safe4337Pack.createTransaction({
            transactions,
            options: {
              feeEstimator: new BestEffortFeeEstimator(rpcUrl, bundlerUrl),
            },
          })

          const userOperation = safeOperation.getUserOperation()
          const signaturePayload = encodeGuardianSignatures(guardianSignatures, guardianThreshold)
          const validAfter = safeOperation.options.validAfter ?? 0
          const validUntil = safeOperation.options.validUntil ?? 0

          userOperation.nonce = encodeValidatorNonce(moduleAddress).toString()
          userOperation.signature = encodePacked(
            ['uint48', 'uint48', 'bytes'],
            [validAfter, validUntil, signaturePayload],
          )

          const bundlerClient =
            this.bundlerClient ??
            new BundlerClient({
              endpoints: [{ url: bundlerUrl, entryPoints: [this.chain.entryPoint] }],
            })

          const userOpHash = await bundlerClient.sendUserOperation(
            userOperationToHexValues(userOperation, this.chain.entryPoint),
            this.chain.entryPoint,
            { entryPoint: this.chain.entryPoint, endpointUrl: bundlerUrl },
          )

          this.bundlerCursor = (this.bundlerCursor + attempt) % bundlerUrls.length
          this.lastBundlerUrl = bundlerUrl
          this.bundlerClient?.markEndpointHealthy(bundlerUrl)
          this.paymasterOptions = paymasterOptions
          this.lastPaymasterStatus = paymasterStatus

          await this.persistRecoveredOwners(newOwners, newThreshold)
          return { chainId: this.chain.chainId, userOpHash, paymasterStatus }
        } catch (error) {
          lastError = error
          if (mode !== 'native') {
            fallbackReason = this.formatPaymasterFailure(mode, error)
            continue
          }
        }

        break
      }

      if (this.bundlerClient) {
        this.bundlerClient.markEndpointFailure(bundlerUrl, lastError)
      }
    }

    throw lastError ?? new Error('Failed to submit recovery user operation')
  }

  private resolveRecoveryModuleAddress(moduleAddress?: HexAddress) {
    return moduleAddress ?? SOCIAL_RECOVERY_MODULE_ADDRESS
  }

  private findAllowlistEntry(moduleAddress: HexAddress): ModuleAllowlistEntry | undefined {
    return this.chain.moduleAllowlist?.find(
      (entry) => entry.address.toLowerCase() === moduleAddress.toLowerCase(),
    )
  }

  private async assertModuleAllowed({
    moduleAddress,
    allowUnsafe,
    publicClient,
  }: {
    moduleAddress: HexAddress
    allowUnsafe?: boolean
    publicClient: PublicClient
  }) {
    const allowlistEntry = this.findAllowlistEntry(moduleAddress)
    if (!allowlistEntry) {
      if (allowUnsafe) {
        return
      }
      throw new Error('Module is not allowlisted; enable advanced module install to proceed')
    }

    if (!allowlistEntry.bytecodeHash) {
      return
    }

    const bytecode = await publicClient.getBytecode({ address: moduleAddress })
    if (!bytecode) {
      throw new Error('Module bytecode is not available on this chain')
    }

    const bytecodeHash = keccak256(bytecode)
    if (bytecodeHash.toLowerCase() !== allowlistEntry.bytecodeHash.toLowerCase()) {
      if (allowUnsafe) {
        return
      }
      throw new Error('Module bytecode hash does not match allowlist entry')
    }
  }

  private async fetchSocialRecoveryGuardians(
    publicClient: PublicClient,
    safeAddress: HexAddress,
    moduleAddress: HexAddress,
  ) {
    try {
      const guardians = (await publicClient.readContract({
        address: moduleAddress,
        abi: SOCIAL_RECOVERY_ABI,
        functionName: 'getGuardians',
        args: [safeAddress],
      })) as HexAddress[]
      return normalizeGuardianList(guardians)
    } catch {
      return []
    }
  }

  private async fetchSocialRecoveryThreshold(
    publicClient: PublicClient,
    safeAddress: HexAddress,
    moduleAddress: HexAddress,
  ) {
    try {
      const threshold = (await publicClient.readContract({
        address: moduleAddress,
        abi: SOCIAL_RECOVERY_ABI,
        functionName: 'threshold',
        args: [safeAddress],
      })) as bigint
      return Number(threshold)
    } catch {
      return null
    }
  }

  private async isSocialRecoveryInstalled(
    publicClient: PublicClient,
    safeAddress: HexAddress,
    moduleAddress: HexAddress,
  ) {
    try {
      return await publicClient.readContract({
        address: safeAddress,
        abi: ERC7579_ACCOUNT_ABI,
        functionName: 'isModuleInstalled',
        args: [1n, moduleAddress, '0x'],
      })
    } catch {
      return false
    }
  }

  private async buildOwnerRotationCalls({
    owners,
    threshold,
  }: {
    owners: HexAddress[]
    threshold: number
  }): Promise<Call[]> {
    const safeAddress = this.requireSafeAddress()
    const protocolKit = await Safe.init({
      provider: this.provider as SafeProviderConfig['provider'],
      signer: this.signer as SafeProviderConfig['signer'],
      safeAddress,
      contractNetworks: buildContractNetworks(this.chain),
    })

    const [currentOwners, currentThreshold] = await Promise.all([
      protocolKit.getOwners(),
      protocolKit.getThreshold(),
    ])

    const normalizedOwners = normalizeGuardianList(owners)
    const currentOwnerSet = new Set(currentOwners.map((owner) => owner.toLowerCase()))
    const desiredOwnerSet = new Set(normalizedOwners.map((owner) => owner.toLowerCase()))
    const ownersToAdd = normalizedOwners.filter((owner) => !currentOwnerSet.has(owner.toLowerCase()))
    const ownersToRemove = currentOwners.filter(
      (owner) => !desiredOwnerSet.has(owner.toLowerCase()),
    )

    const calls: Call[] = []
    let workingOwners = [...currentOwners]
    let workingThreshold = currentThreshold

    for (const owner of ownersToAdd) {
      const tx = await protocolKit.createAddOwnerTx({ ownerAddress: owner })
      calls.push({
        to: tx.data.to as HexAddress,
        data: tx.data.data as HexData,
        value: BigInt(tx.data.value ?? '0'),
      })
      workingOwners = [...workingOwners, owner]
    }

    for (const owner of ownersToRemove) {
      workingThreshold = Math.min(workingThreshold, Math.max(1, workingOwners.length - 1))
      const tx = await protocolKit.createRemoveOwnerTx({
        ownerAddress: owner,
        threshold: workingThreshold,
      })
      calls.push({
        to: tx.data.to as HexAddress,
        data: tx.data.data as HexData,
        value: BigInt(tx.data.value ?? '0'),
      })
      workingOwners = workingOwners.filter((existing) => existing.toLowerCase() !== owner.toLowerCase())
    }

    if (workingThreshold !== threshold) {
      const tx = await protocolKit.createChangeThresholdTx(threshold)
      calls.push({
        to: tx.data.to as HexAddress,
        data: tx.data.data as HexData,
        value: BigInt(tx.data.value ?? '0'),
      })
    }

    return calls
  }

  private async persistRecoveredOwners(owners: HexAddress[], threshold: number) {
    await updateWalletState((current) => ({
      ...current,
      ownerConfig: {
        owners,
        threshold,
      },
    }))
  }

  private getPaymasterModePlan(requestedMode: PaymasterMode): PaymasterMode[] {
    switch (requestedMode) {
      case 'sponsored':
        return ['sponsored', 'native']
      case 'usdc':
        return ['usdc', 'native']
      case 'native':
        return ['native']
      case 'auto':
      default:
        return ['sponsored', 'usdc', 'native']
    }
  }

  private async resolvePaymasterOptionsForMode({
    mode,
    bundlerUrl,
    rpcUrl,
    walletState,
    requestedMode,
  }: {
    mode: PaymasterMode
    bundlerUrl?: string
    rpcUrl?: string
    walletState: WalletStatePayload | null
    requestedMode: PaymasterMode
  }): Promise<{
    available: boolean
    options?: Safe4337PaymasterOptions
    reason?: string
    reportAsFallback?: boolean
  }> {
    if (mode === 'native') {
      return { available: true, options: undefined as Safe4337PaymasterOptions | undefined }
    }

    if (mode === 'sponsored') {
      if (!this.enableSponsoredPaymaster) {
        return {
          available: false,
          reason: 'Sponsored paymaster is disabled until Phase 13.',
          reportAsFallback: requestedMode === 'sponsored',
        }
      }

      const resolution = resolveSponsorPaymasterOptions(
        this.chain,
        this.paymasterOverrides?.sponsor,
        bundlerUrl,
      )
      return {
        ...resolution,
        reportAsFallback: requestedMode === 'sponsored',
      }
    }

    const resolution = resolveCirclePaymasterOptions(
      this.chain,
      this.paymasterOverrides?.circle,
      bundlerUrl,
    )

    if (!resolution.available) {
      return {
        ...resolution,
        reportAsFallback: requestedMode === 'usdc' || requestedMode === 'auto',
      }
    }

    if (requestedMode === 'auto') {
      if (!rpcUrl) {
        return {
          available: false,
          reason: 'RPC unavailable for USDC balance check.',
          reportAsFallback: true,
        }
      }

      const tokenAddress = resolution.options?.paymasterTokenAddress
      if (!tokenAddress) {
        return {
          available: false,
          reason: 'USDC token address missing.',
          reportAsFallback: true,
        }
      }

      try {
        const address = await this.resolveSafeAddressForPaymaster(walletState, resolution.options)
        const balance = await this.getErc20Balance(tokenAddress, address, rpcUrl)
        if (balance <= 0n) {
          return {
            available: false,
            reason: 'No USDC balance available for gas.',
            reportAsFallback: true,
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown error')
        return {
          available: false,
          reason: `Failed to check USDC balance: ${message}`,
          reportAsFallback: true,
        }
      }
    }

    return {
      ...resolution,
      reportAsFallback: requestedMode === 'usdc' || requestedMode === 'auto',
    }
  }

  private buildFallbackWalletState(): WalletStatePayload {
    return {
      passkeys: [],
      ownerConfig: this.ownerConfigOverride,
      chainState: {},
      overrides: {},
      deploymentConfigByChain: {},
    }
  }

  private async resolveSafeAddressForPaymaster(
    walletState: WalletStatePayload | null,
    paymasterOptions?: Safe4337PaymasterOptions,
  ): Promise<HexAddress> {
    if (this.safeAddress) {
      return this.safeAddress
    }

    const resolvedState = walletState ?? this.buildFallbackWalletState()
    if (!resolvedState.ownerConfig && !this.ownerConfigOverride) {
      throw new Error('Owner config is required to predict Safe address')
    }

    const predictedConfig = await this.buildPredictedSafeConfig(resolvedState, paymasterOptions)
    return (await predictSafeAddress({
      safeProvider: predictedConfig.safeProvider,
      chainId: BigInt(this.chain.chainId),
      safeAccountConfig: predictedConfig.safeAccountConfig,
      safeDeploymentConfig: predictedConfig.safeDeploymentConfig,
      customContracts: {
        safeProxyFactoryAddress: this.chain.safeProxyFactory,
        safeSingletonAddress: this.chain.safeSingleton,
      },
    })) as HexAddress
  }

  private async getErc20Balance(token: HexAddress, owner: HexAddress, rpcUrl: string): Promise<bigint> {
    const client = this.rpcClient ?? new RpcClient({ urls: [rpcUrl] })
    const data = encodeFunctionData({
      abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })
    const response = await client.call({ to: token, data })
    return BigInt(response)
  }

  private normalizeBundlerUserOperationParams(params: unknown[]) {
    if (params.length === 0) {
      return params
    }

    const [userOperation, entryPoint, ...rest] = params
    if (!userOperation || typeof userOperation !== 'object') {
      return params
    }

    const normalized = { ...(userOperation as Record<string, unknown>) }
    const hasPackedFields =
      'accountGasLimits' in normalized || 'gasFees' in normalized || 'paymasterAndData' in normalized
    const hasUnpackedFields =
      'factory' in normalized ||
      'factoryData' in normalized ||
      'paymaster' in normalized ||
      'paymasterData' in normalized ||
      'callGasLimit' in normalized ||
      'verificationGasLimit' in normalized
    if (hasPackedFields && !hasUnpackedFields) {
      return [normalized, entryPoint, ...rest]
    }

    const paymaster = normalized.paymaster
    const paymasterData = normalized.paymasterData
    const emptyPaymaster =
      typeof paymaster === 'string' && (paymaster === '0x' || paymaster === '0x0')
    const missingPaymaster = paymaster == null
    const emptyPaymasterData = paymasterData == null || paymasterData === '0x'

    if ((emptyPaymaster || missingPaymaster) && emptyPaymasterData) {
      delete normalized.paymaster
      delete normalized.paymasterData
      delete normalized.paymasterVerificationGasLimit
      delete normalized.paymasterPostOpGasLimit
    }

    return [normalized, entryPoint, ...rest]
  }

  private shouldBypassBundlerEstimate(bundlerUrl: string) {
    if (this.chain.chainId === 31337) {
      return true
    }

    const lowered = bundlerUrl.toLowerCase()
    return lowered.includes('localhost') || lowered.includes('127.0.0.1')
  }

  private buildFallbackUserOperationGasEstimate(userOperation: Record<string, unknown>) {
    const paymaster = userOperation.paymaster
    const paymasterData = userOperation.paymasterData
    const hasPaymaster =
      (typeof paymaster === 'string' &&
        paymaster !== '0x' &&
        paymaster !== '0x0' &&
        paymaster !== ZERO_ADDRESS) ||
      (typeof paymasterData === 'string' && paymasterData !== '0x')

    return {
      callGasLimit: this.toHexQuantity(LOCAL_ESTIMATE_CALL_GAS_LIMIT),
      verificationGasLimit: this.toHexQuantity(LOCAL_ESTIMATE_VERIFICATION_GAS_LIMIT),
      preVerificationGas: this.toHexQuantity(LOCAL_ESTIMATE_PRE_VERIFICATION_GAS),
      ...(hasPaymaster
        ? {
            paymasterVerificationGasLimit: this.toHexQuantity(LOCAL_ESTIMATE_PAYMASTER_GAS_LIMIT),
            paymasterPostOpGasLimit: this.toHexQuantity(LOCAL_ESTIMATE_PAYMASTER_GAS_LIMIT),
          }
        : {}),
    }
  }

  private toHexQuantity(value: bigint) {
    return `0x${value.toString(16)}`
  }

  private formatPaymasterFailure(mode: PaymasterMode, error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
    return `${mode} paymaster failed: ${message}`
  }

  private getBundlerUrls() {
    if (this.bundlerClient) {
      return this.bundlerClient.getEndpointUrls()
    }

    return this.bundlerUrls
  }

  private async selectBundlerUrl(attempt: number): Promise<string> {
    const bundlerUrls = this.getBundlerUrls()
    if (bundlerUrls.length === 0) {
      throw new Error('No bundler endpoints configured')
    }

    if (this.bundlerClient) {
      const endpoint = await this.bundlerClient.selectEndpoint({
        entryPoint: this.chain.entryPoint,
        maxAttempts: bundlerUrls.length,
      })
      const index = bundlerUrls.indexOf(endpoint.url)
      if (index >= 0) {
        this.bundlerCursor = index
      }
      return endpoint.url
    }

    return bundlerUrls[(this.bundlerCursor + attempt) % bundlerUrls.length]
  }

  private async selectRpcUrl(): Promise<string | undefined> {
    if (this.rpcClient) {
      try {
        return await this.rpcClient.selectEndpoint({ maxAttempts: this.rpcUrls.length })
      } catch {
        return this.rpcUrls[0]
      }
    }

    return this.rpcUrls[0]
  }

  private async initSafe4337Pack(
    bundlerUrl: string,
    paymasterOptions: Safe4337PaymasterOptions | undefined = this.paymasterOptions,
  ) {
    if (this.chain.entryPoint === ZERO_ADDRESS) {
      throw new Error('EntryPoint address is required for ERC-4337 operations')
    }

    const moduleAddress = resolveSafe4337ModuleAddress(this.chain)
    const safeWebAuthnSharedSignerAddress =
      this.chain.safeWebAuthnSharedSigner && this.chain.safeWebAuthnSharedSigner !== ZERO_ADDRESS
        ? this.chain.safeWebAuthnSharedSigner
        : undefined

    const resolvedWalletState = await this.ensurePasskeyOwnerConfig(await getWalletState())
    const chainKey = String(this.chain.chainId)
    let shouldUseDeployedSafe = false

    if (this.safeAddress) {
      const chainState = resolvedWalletState.chainState?.[chainKey]
      if (typeof chainState?.deployed === 'boolean') {
        shouldUseDeployedSafe = chainState.deployed
      } else {
        try {
          shouldUseDeployedSafe = await this.isSafeAddressDeployed(this.safeAddress)
        } catch {
          shouldUseDeployedSafe = false
        }
      }
    }

    if (this.safeAddress && shouldUseDeployedSafe) {
      const protocolKit = await Safe.init({
        provider: this.provider as SafeProviderConfig['provider'],
        signer: this.signer as SafeProviderConfig['signer'],
        safeAddress: this.safeAddress,
        contractNetworks: buildContractNetworks(this.chain),
      })
      const bundlerClient = this.configureBundlerClient(
        createBundlerClient(bundlerUrl),
        bundlerUrl,
      )
      const chainId = await bundlerClient.request({ method: 'eth_chainId', params: [] })
      return new Safe4337Pack({
        protocolKit,
        bundlerClient,
        bundlerUrl,
        chainId: BigInt(chainId),
        paymasterOptions: paymasterOptions as Safe4337InitParams['paymasterOptions'],
        entryPointAddress: this.chain.entryPoint,
        safe4337ModuleAddress: moduleAddress,
        safeWebAuthnSharedSignerAddress,
      })
    }

    if (!resolvedWalletState.ownerConfig && !this.ownerConfigOverride) {
      throw new Error('Owner config is required to deploy a Safe')
    }

    const predictedConfig = await this.buildPredictedSafeConfig(resolvedWalletState, paymasterOptions)
    const protocolKit = await Safe.init({
      provider: this.provider as SafeProviderConfig['provider'],
      signer: this.signer as SafeProviderConfig['signer'],
      predictedSafe: {
        safeAccountConfig: predictedConfig.safeAccountConfig,
        safeDeploymentConfig: predictedConfig.safeDeploymentConfig,
      },
      contractNetworks: buildContractNetworks(this.chain),
    })
    const bundlerClient = this.configureBundlerClient(
      createBundlerClient(bundlerUrl),
      bundlerUrl,
    )
    const chainId = await bundlerClient.request({ method: 'eth_chainId', params: [] })
    const safe4337Pack = new Safe4337Pack({
      protocolKit,
      bundlerClient,
      bundlerUrl,
      chainId: BigInt(chainId),
      paymasterOptions: paymasterOptions as Safe4337InitParams['paymasterOptions'],
      entryPointAddress: this.chain.entryPoint,
      safe4337ModuleAddress: moduleAddress,
      safeWebAuthnSharedSignerAddress,
    })

    this.safeAddress = (await protocolKit.getAddress()) as HexAddress
    return safe4337Pack
  }

  private configureBundlerClient(
    bundlerClient: ReturnType<typeof createBundlerClient>,
    bundlerUrl: string,
  ) {
    const bundlerTransport = (bundlerClient as typeof bundlerClient & { transport?: unknown })
      .transport as { request?: (args: unknown) => Promise<unknown> } | undefined
    const shouldBypassEstimate = this.shouldBypassBundlerEstimate(bundlerUrl)
    const normalizeBundlerArgs = (args: unknown) => {
      const record = (args ?? {}) as Record<string, unknown>
      const params = (record.params as unknown[] | undefined) ?? []
      if (record.method === 'eth_estimateUserOperationGas' || record.method === 'eth_sendUserOperation') {
        return {
          ...record,
          params: this.normalizeBundlerUserOperationParams(params),
        }
      }

      return {
        ...record,
        params,
      }
    }
    type BundlerRequest = (args: unknown) => Promise<unknown>
    const wrapRequest = (request: BundlerRequest): BundlerRequest => async (args: unknown) => {
      const normalizedArgs = normalizeBundlerArgs(args)
      const record = (normalizedArgs ?? {}) as Record<string, unknown>
      if (record.method === 'eth_estimateUserOperationGas' && shouldBypassEstimate) {
        const params = (record.params as unknown[] | undefined) ?? []
        const [userOperation] = params
        return this.buildFallbackUserOperationGasEstimate(
          userOperation && typeof userOperation === 'object'
            ? (userOperation as Record<string, unknown>)
            : {},
        )
      }

      return request(normalizedArgs)
    }

    if (bundlerTransport?.request) {
      const transportRequest = bundlerTransport.request.bind(bundlerTransport)
      bundlerTransport.request = wrapRequest(transportRequest)
    }
    const bundlerRequest = bundlerClient.request.bind(bundlerClient) as BundlerRequest
    bundlerClient.request = wrapRequest(bundlerRequest) as typeof bundlerClient.request

    return bundlerClient
  }

  private requireSafeAddress(): HexAddress {
    if (!this.safeAddress) {
      throw new Error('Safe address is required for owner changes')
    }

    return this.safeAddress
  }

  private async ensureSafeDeployed(safeAddress: HexAddress) {
    const safeProvider = new SafeProvider({
      provider: this.provider as SafeProviderConfig['provider'],
    })
    const code = await safeProvider.getContractCode(safeAddress)
    if (code === '0x') {
      throw new Error('Safe must be deployed before adding owners')
    }
  }

  private buildDeploymentCalls(safeAddress: HexAddress, options: SendCallsOptions): Call[] {
    const calls: Call[] = []
    const safe7579Adapter = this.chain.safe7579Adapter

    if (safe7579Adapter && safe7579Adapter !== ZERO_ADDRESS) {
      calls.push({
        to: safeAddress,
        data: encodeFunctionData({
          abi: SAFE_ENABLE_MODULE_ABI,
          functionName: 'enableModule',
          args: [safe7579Adapter],
        }),
        value: 0n,
      })
    }

    if (options.deploymentCalls && options.deploymentCalls.length > 0) {
      calls.push(...options.deploymentCalls)
    }

    return calls
  }

  private async buildPredictedSafeConfig(
    walletState: WalletStatePayload,
    paymasterOptions: Safe4337PaymasterOptions | undefined = this.paymasterOptions,
  ) {
    const ownerConfig = this.ownerConfigOverride ?? walletState.ownerConfig
    if (!ownerConfig) {
      throw new Error('Owner config is required to deploy a Safe')
    }

    const chainKey = String(this.chain.chainId)
    const safeVersion = this.safeVersion ?? SAFE_VERSION
    const baseOwners = ownerConfig.owners
    const threshold = ownerConfig.threshold || DEFAULT_THRESHOLD
    const saltNonce =
      walletState.deploymentConfigByChain[chainKey]?.saltNonce ?? PREDETERMINED_SALT_NONCE
    const contractNetworks = buildContractNetworks(this.chain)
    const contractNetwork = contractNetworks?.[chainKey]
    const safeProvider = await SafeProvider.init({
      provider: this.provider as SafeProviderConfig['provider'],
      signer: this.signer as SafeProviderConfig['signer'],
      safeVersion,
      contractNetworks,
    })

    const moduleSetup = buildSafe4337ModuleSetupCall(this.chain)
    const setupTransactions: MetaTransactionData[] = [
      {
        to: moduleSetup.to,
        value: (moduleSetup.value ?? 0n).toString(),
        data: moduleSetup.data ?? '0x',
        operation: OperationType.DelegateCall,
      },
    ]

    const shouldApprovePaymaster =
      !!paymasterOptions?.paymasterAddress &&
      !!paymasterOptions?.paymasterTokenAddress &&
      !paymasterOptions?.isSponsored

    if (shouldApprovePaymaster) {
      const amount = paymasterOptions?.amountToApprove ?? MAX_ERC20_APPROVAL
      setupTransactions.push({
        to: paymasterOptions!.paymasterTokenAddress!,
        value: '0',
        data: encodeFunctionData({
          abi: ERC20_APPROVE_ABI,
          functionName: 'approve',
          args: [paymasterOptions!.paymasterAddress!, amount],
        }),
        operation: OperationType.Call,
      })
    }

    let owners = [...baseOwners]
    const hasSigner = !!this.signer
    const shouldCheckPasskey = !this.ownerConfigOverride && walletState.passkeys.length > 0
    if (!hasSigner && shouldCheckPasskey) {
      throw new Error('Signer is required to resolve passkey deployment config')
    }
    const isPasskeySigner =
      hasSigner && shouldCheckPasskey ? await safeProvider.isPasskeySigner() : false

    if (isPasskeySigner) {
      const sharedSigner = this.chain.safeWebAuthnSharedSigner
      if (!sharedSigner || sharedSigner === ZERO_ADDRESS) {
        throw new Error('safeWebAuthnSharedSigner address is required for passkey deployment')
      }

      if (!owners.includes(sharedSigner)) {
        owners = [...owners, sharedSigner]
      }

      const externalSigner = await safeProvider.getExternalSigner()
      if (!externalSigner || typeof (externalSigner as PasskeyClient).encodeConfigure !== 'function') {
        throw new Error('Failed to resolve passkey signer for deployment')
      }

      const passkeySigner = externalSigner as PasskeyClient
      setupTransactions.push({
        to: sharedSigner,
        value: '0',
        data: passkeySigner.encodeConfigure(),
        operation: OperationType.DelegateCall,
      })
    }

    let deploymentTo = setupTransactions[0].to
    let deploymentData = setupTransactions[0].data

    if (setupTransactions.length > 1) {
      const multiSendContract = await getMultiSendContract({
        safeProvider,
        safeVersion,
        customContracts: contractNetwork,
      })
      deploymentTo = multiSendContract.getAddress()
      deploymentData = encodeFunctionData({
        abi: MULTI_SEND_ABI,
        functionName: 'multiSend',
        args: [encodeMultiSendData(setupTransactions) as HexData],
      })
    }

    const fallbackHandler = resolveSafe4337FallbackHandler(this.chain)
    const safeAccountConfig: SafeAccountConfig = {
      owners,
      threshold,
      to: deploymentTo,
      data: deploymentData,
      fallbackHandler,
      paymentToken: ZERO_ADDRESS,
      payment: 0,
      paymentReceiver: ZERO_ADDRESS,
    }
    const safeDeploymentConfig: SafeDeploymentConfig = {
      safeVersion,
      saltNonce,
    }
    const configHash = JSON.stringify({
      owners,
      threshold,
      fallbackHandler,
      to: deploymentTo,
      data: deploymentData,
      saltNonce,
      safeVersion,
    })

    if (!walletState.deploymentConfigByChain[chainKey]?.saltNonce) {
      await updateWalletState((current) => ({
        ...current,
        deploymentConfigByChain: {
          ...current.deploymentConfigByChain,
          [chainKey]: { saltNonce },
        },
      }))
    }

    return {
      owners,
      threshold,
      saltNonce,
      safeAccountConfig,
      safeDeploymentConfig,
      configHash,
      safeProvider,
    }
  }

  private async ensurePasskeyOwnerConfig(walletState: WalletState | null): Promise<WalletStatePayload> {
    const fallback = walletState ?? this.buildFallbackWalletState()

    if (this.ownerConfigOverride) {
      return fallback
    }

    if (!fallback.passkeys.length) {
      return fallback
    }

    const chainKey = String(this.chain.chainId)
    const chainState = fallback.chainState?.[chainKey]
    if (chainState?.deployed) {
      return fallback
    }

    const primaryPasskey = fallback.passkeys.find((passkey) => isValidPasskeyMetadata(passkey))
    if (!primaryPasskey) {
      return fallback
    }
    let passkeyInfo: Awaited<ReturnType<typeof resolvePasskeySigner>>
    try {
      passkeyInfo = await resolvePasskeySigner({
        chain: this.chain,
        provider: this.provider as SafeProviderConfig['provider'],
        passkey: primaryPasskey,
        safeVersion: this.safeVersion,
      })
    } catch (error) {
      console.warn('[SafeWalletController] Failed to resolve passkey signer for owner config.', error)
      return fallback
    }

    const ownerConfig = fallback.ownerConfig ?? { owners: [], threshold: DEFAULT_THRESHOLD }
    const normalizedOwners = ownerConfig.owners
    const passkeyAddress = passkeyInfo.address.toLowerCase()
    const hasPasskeyOwner = normalizedOwners.some((owner) => owner.toLowerCase() === passkeyAddress)

    if (hasPasskeyOwner) {
      return fallback
    }

    const shouldReplaceOwners =
      normalizedOwners.length === 0 || (normalizedOwners.length === 1 && ownerConfig.threshold <= 1)
    const nextOwners = shouldReplaceOwners
      ? [passkeyInfo.address]
      : [...normalizedOwners, passkeyInfo.address]

    const nextState = await updateWalletState((current) => ({
      ...current,
      ownerConfig: {
        owners: nextOwners,
        threshold: ownerConfig.threshold || DEFAULT_THRESHOLD,
      },
      chainState: {
        ...current.chainState,
        [chainKey]: {
          ...current.chainState[chainKey],
          predictedAddress: undefined,
          configHash: undefined,
        },
      },
    }))

    return nextState
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity as ActivityIcon,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Check,
  Copy,
  CreditCard,
  Send,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  Wallet,
} from 'lucide-react'
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
  parseUnits,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { toast } from 'sonner'

import type { ChainConfig, HexAddress, HexData, PasskeyMetadata, PaymasterMode } from '../types'
import type { EncryptedPayload, WalletOwnerConfig, WalletState, WalletStatePayload } from '../storage/types'
import { CHAIN_CONFIGS, DEFAULT_CHAIN_KEYS, type WalletChainKey } from '../chain'
import { SafeWalletController } from '../core'
import { buildApproveAndCallBatch } from '../core/transactions'
import {
  createPasskeyMetadata,
  isValidPasskeyMetadata,
  resolvePasskeyRpId,
  resolvePasskeySigner,
} from '../signers'
import {
  connectInjectedSigner,
  connectWalletConnectSigner,
  createLocalSigner,
  type Eip1193Provider,
  type PortableSigner,
} from '../signers/portable'
import { createStorageCrypto } from '../storage/crypto'
import { getWalletState, setChainOverrides, setWalletState, updateWalletState } from '../storage'
import { RecoverySetupPanel } from './RecoverySetupPanel'

const glassyBase =
  'backdrop panel-surface relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-0'
const glassyNeutral = 'panel-surface--neutral'
const glassyMuted = 'panel-surface--muted'
const glassyActive = 'panel-surface--active'
const glassyPrimary = 'panel-surface--primary'
const glassySuccess = 'panel-surface--success'

const WALLET_CHAIN_KEY_STORAGE = 'demo_wallet_chain'
const DEFAULT_CHAIN_KEY = DEFAULT_CHAIN_KEYS[0]
const ERC20_BALANCE_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)'])
const ERC20_TRANSFER_ABI = parseAbi(['function transfer(address to,uint256 amount)'])
const ENTRYPOINT_USEROP_EVENT = parseAbiItem(
  'event UserOperationEvent(bytes32 userOpHash,address sender,address paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)',
)
const ERC20_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from,address indexed to,uint256 value)',
)
const LOCAL_DEV_PRIVATE_KEY: HexData =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const LOCAL_DEV_ACCOUNT = privateKeyToAccount(LOCAL_DEV_PRIVATE_KEY)
const LOCAL_DEV_OWNER_CONFIG: WalletOwnerConfig = {
  owners: [LOCAL_DEV_ACCOUNT.address as HexAddress],
  threshold: 1,
}

const formatChainId = (chainId: number) => `0x${chainId.toString(16)}`
const formatUsdcBalance = (value: bigint) => {
  const formatted = formatUnits(value, 6)
  const [whole, fraction = ''] = formatted.split('.')
  const trimmed = fraction.replace(/0+$/, '').slice(0, 2)
  return trimmed ? `${whole}.${trimmed}` : whole
}
const parseChainId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    try {
      return Number(BigInt(value))
    } catch {
      return null
    }
  }
  return null
}

const assertProviderChain = async (
  provider: Eip1193Provider,
  chain: ChainConfig,
  label = 'Connected wallet',
) => {
  const rawChainId = await provider.request({ method: 'eth_chainId' })
  const resolved = parseChainId(rawChainId)
  if (!resolved) {
    throw new Error(`${label} did not return a valid chainId`)
  }
  if (resolved !== chain.chainId) {
    throw new Error(
      `${label} is on chain ${formatChainId(resolved)}. Switch to ${chain.name} (${formatChainId(
        chain.chainId,
      )}) to continue.`,
    )
  }
}

const resolveInitialChainKey = (): WalletChainKey => {
  if (typeof window === 'undefined') {
    return DEFAULT_CHAIN_KEY
  }

  const stored = window.localStorage.getItem(WALLET_CHAIN_KEY_STORAGE)
  if (stored && stored in CHAIN_CONFIGS) {
    return stored as WalletChainKey
  }

  return DEFAULT_CHAIN_KEY
}

const formatAddress = (value?: string | null) => {
  if (!value) return '--'
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

const normalizeUrls = (value: string) =>
  value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)

const applyOverrides = (chain: ChainConfig, state: WalletState | null): ChainConfig => {
  const overrides = state?.overrides?.[String(chain.chainId)]
  return {
    ...chain,
    rpcUrls: overrides?.rpcUrls && overrides.rpcUrls.length > 0 ? overrides.rpcUrls : chain.rpcUrls,
    bundlerUrls:
      overrides?.bundlerUrls && overrides.bundlerUrls.length > 0
        ? overrides.bundlerUrls
        : chain.bundlerUrls,
  }
}

const buildBundlerEndpoints = (chain: ChainConfig) =>
  (chain.bundlerUrls ?? []).map((url) => ({ url, entryPoints: [chain.entryPoint] }))

const selectPasskeyForRpId = (
  passkeys: PasskeyMetadata[] | undefined,
  rpId: string | undefined,
): PasskeyMetadata | null => {
  if (!passkeys || passkeys.length === 0) return null
  const validPasskeys = passkeys.filter((passkey) => isValidPasskeyMetadata(passkey))
  if (validPasskeys.length === 0) return null
  if (!rpId) return passkeys[0] ?? null

  const exact = validPasskeys.find((passkey) => passkey.rpId === rpId)
  if (exact) return exact

  const legacy = validPasskeys.find((passkey) => !passkey.rpId)
  return legacy ?? null
}

const isPortableSignerConnection = (
  signer: PortableSigner | null,
): signer is Extract<PortableSigner, { type: 'injected' | 'walletconnect' }> =>
  !!signer && signer.type !== 'local'

const useWalletState = () => {
  const [state, setState] = useState<WalletState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const nextState = await getWalletState()
      setState(nextState)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet state')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { state, isLoading, error, refresh }
}

type WalletPanelProps = {
  onClose?: () => void
}

export function WalletPanel({ onClose }: WalletPanelProps) {
  const { state, isLoading, error, refresh } = useWalletState()
  const [chainKey, setChainKey] = useState<WalletChainKey>(resolveInitialChainKey)
  const [activeSection, setActiveSection] = useState<
    'onboarding' | 'purchase' | 'activity'
  >('onboarding')
  const [portableSigner, setPortableSigner] = useState<PortableSigner | null>(null)
  const deploymentProbeRef = useRef<string | null>(null)

  const currentRpId = useMemo(() => resolvePasskeyRpId(), [])
  const chain = useMemo(() => applyOverrides(CHAIN_CONFIGS[chainKey], state), [chainKey, state])
  const chainState = state?.chainState?.[String(chain.chainId)]
  const safeAddress = chainState?.predictedAddress
  const chainOverrides = state?.overrides?.[String(chain.chainId)]
  const useLocalDevSigner = chain.chainId === 31337 && !!chainOverrides?.useLocalDevSigner
  const passkeyCount = state?.passkeys?.length ?? 0
  const tokenAddress = chain.circlePaymasterToken
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null)
  const [usdcLoading, setUsdcLoading] = useState(false)
  const passkeyForOrigin = useMemo(
    () => selectPasskeyForRpId(state?.passkeys, currentRpId),
    [state?.passkeys, currentRpId],
  )
  const ownerCount = state?.ownerConfig?.owners?.length ?? 0
  const deployed = chainState?.deployed ?? false

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(WALLET_CHAIN_KEY_STORAGE, chainKey)
  }, [chainKey])

  useEffect(() => {
    if (!safeAddress || deployed || chain.rpcUrls.length === 0) {
      deploymentProbeRef.current = null
      return
    }
    if (deploymentProbeRef.current === safeAddress) {
      return
    }
    deploymentProbeRef.current = safeAddress
    let cancelled = false

    const checkDeployment = async () => {
      try {
        const client = createPublicClient({ transport: http(chain.rpcUrls[0]) })
        const code = await client.getCode({ address: safeAddress })
        if (cancelled) return
        if (code && code !== '0x') {
          await updateWalletState((current) => {
            const chainKeyString = String(chain.chainId)
            return {
              ...current,
              chainState: {
                ...current.chainState,
                [chainKeyString]: {
                  ...current.chainState?.[chainKeyString],
                  deployed: true,
                  lastCheckedAt: new Date().toISOString(),
                },
              },
            }
          })
          await refresh()
        }
      } catch {
        if (!cancelled) {
          deploymentProbeRef.current = null
        }
      }
    }

    void checkDeployment()

    return () => {
      cancelled = true
    }
  }, [chain.chainId, chain.rpcUrls, deployed, refresh, safeAddress])

  useEffect(() => {
    if (!safeAddress || !tokenAddress || chain.rpcUrls.length === 0) {
      setUsdcBalance(null)
      setUsdcLoading(false)
      return
    }

    let cancelled = false
    setUsdcLoading(true)

    const fetchBalance = async () => {
      try {
        const client = createPublicClient({ transport: http(chain.rpcUrls[0]) })
        const balance = await client.readContract({
          address: tokenAddress,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [safeAddress],
        })
        if (!cancelled) {
          setUsdcBalance(balance as bigint)
        }
      } catch {
        if (!cancelled) {
          setUsdcBalance(null)
        }
      } finally {
        if (!cancelled) {
          setUsdcLoading(false)
        }
      }
    }

    void fetchBalance()

    return () => {
      cancelled = true
    }
  }, [chain.rpcUrls, safeAddress, tokenAddress, state])

  const passkeyLabel = passkeyForOrigin
    ? `${passkeyCount} passkey${passkeyCount === 1 ? '' : 's'}`
    : passkeyCount > 0
      ? 'No passkey for this origin'
      : '0 passkeys'
  const statusBadges = [
    {
      label: deployed ? 'Deployed' : 'Counterfactual',
      tone: deployed ? glassySuccess : glassyNeutral,
    },
    {
      label: passkeyLabel,
      tone: passkeyForOrigin ? glassyActive : glassyMuted,
    },
    {
      label: `${ownerCount} owner${ownerCount === 1 ? '' : 's'}`,
      tone: ownerCount > 0 ? glassyActive : glassyMuted,
    },
  ]

  const balances = useMemo(() => {
    if (!tokenAddress) {
      return []
    }
    return [
      {
        label: 'USDC',
        value: usdcLoading
          ? '…'
          : usdcBalance !== null
            ? formatUsdcBalance(usdcBalance)
            : '--',
      },
    ]
  }, [tokenAddress, usdcBalance, usdcLoading])

  return (
    <div className="flex flex-col gap-6" data-ui="wallet-panel">
      <div className="flex flex-col gap-3" data-part="wallet-header">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-sky-500/20 flex items-center justify-center">
              <Wallet className="w-5 h-5 text-sky-200" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-gray-400">Wallet</p>
              <h3 className="text-lg font-semibold text-gray-100">Demo Smart Account</h3>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className={`px-3 py-1.5 text-xs font-medium rounded-full ${glassyBase} ${glassyNeutral} flex items-center gap-2`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className={`px-3 py-1.5 text-xs font-medium rounded-full ${glassyBase} ${glassyMuted}`}
              >
                Close
              </button>
            )}
          </div>
        </div>

        <div className={`p-4 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Network</span>
              <select
                value={chainKey}
                onChange={(event) => setChainKey(event.target.value as WalletChainKey)}
                className={`px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10 ${glassyBase} ${glassyActive}`}
              >
                {DEFAULT_CHAIN_KEYS.map((key) => (
                  <option key={key} value={key} className="text-gray-900">
                    {CHAIN_CONFIGS[key].name}
                  </option>
                ))}
              </select>
              <div className="flex flex-wrap items-center gap-2">
                {statusBadges.map((badge) => (
                  <span
                    key={badge.label}
                    className={`px-3 py-1 text-xs font-medium rounded-full ${glassyBase} ${badge.tone}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Address</p>
                <p className="text-sm font-mono text-gray-200">
                  {safeAddress ??
                    (useLocalDevSigner
                      ? 'Local dev signer enabled - generate address to preview.'
                      : 'Create a passkey to generate your address')}
                </p>
                {useLocalDevSigner && (
                  <p className="text-xs text-amber-200/80">
                    Local dev mode ignores passkey ownership; the dev Safe address is not persisted.
                  </p>
                )}
              </div>
              {safeAddress && (
                <div className="flex items-center gap-2">
                  <CopyAddressButton address={safeAddress} />
                </div>
              )}
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Balances</p>
                {!safeAddress && (
                  <span className="text-xs text-gray-500">
                    Generate an address to load balances.
                  </span>
                )}
              </div>
              <div className={`mt-3 rounded-xl border border-white/10 ${glassyBase} ${glassyMuted}`}>
                <div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-gray-500">
                  <span>Asset</span>
                  <span>Balance</span>
                </div>
                <div className="flex flex-col divide-y divide-white/10">
                  {balances.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-400">
                      {safeAddress ? 'No balances available.' : '—'}
                    </div>
                  ) : (
                    balances.map((balance) => (
                      <div
                        key={balance.label}
                        className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3 text-sm text-gray-100"
                      >
                        <span className="font-medium">{balance.label}</span>
                        <span className="font-mono">{balance.value}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Wallet sections">
        <SectionTab
          label="Setup"
          icon={<Sparkles className="w-4 h-4" />}
          isActive={activeSection === 'onboarding'}
          onClick={() => setActiveSection('onboarding')}
        />
        <SectionTab
          label="Send"
          icon={<Send className="w-4 h-4" />}
          isActive={activeSection === 'purchase'}
          onClick={() => setActiveSection('purchase')}
        />
        <SectionTab
          label="Activity"
          icon={<ActivityIcon className="w-4 h-4" />}
          isActive={activeSection === 'activity'}
          onClick={() => setActiveSection('activity')}
        />
      </div>

      {activeSection === 'onboarding' && (
        <WalletOnboardingPanel
          chain={chain}
          walletState={state}
          safeAddress={safeAddress}
          useLocalDevSigner={useLocalDevSigner}
          currentRpId={currentRpId}
          passkeyForOrigin={passkeyForOrigin}
          portableSigner={portableSigner}
          onPortableSignerChange={setPortableSigner}
          onRefresh={refresh}
        />
      )}
      {activeSection === 'purchase' && (
        <WalletPurchasePanel
          chain={chain}
          walletState={state}
          safeAddress={safeAddress}
          useLocalDevSigner={useLocalDevSigner}
          currentRpId={currentRpId}
          passkeyForOrigin={passkeyForOrigin}
          portableSigner={portableSigner}
          onRefresh={refresh}
        />
      )}
      {activeSection === 'activity' && (
        <WalletActivityPanel chain={chain} walletState={state} safeAddress={safeAddress} />
      )}
    </div>
  )
}

function SectionTab({
  label,
  icon,
  isActive,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={`px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2 ${glassyBase} ${
        isActive ? glassyActive : glassyNeutral
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function CopyAddressButton({ address }: { address: HexAddress }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[WalletPanel] Failed to copy address', err)
    }
  }, [address])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`px-3 py-1.5 text-xs font-medium rounded-full ${glassyBase} ${
        copied ? glassySuccess : glassyMuted
      } flex items-center gap-2`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function WalletOnboardingPanel({
  chain,
  walletState,
  safeAddress,
  useLocalDevSigner,
  currentRpId,
  passkeyForOrigin,
  portableSigner,
  onPortableSignerChange,
  onRefresh,
}: {
  chain: ChainConfig
  walletState: WalletState | null
  safeAddress?: HexAddress
  useLocalDevSigner?: boolean
  currentRpId?: string
  passkeyForOrigin: PasskeyMetadata | null
  portableSigner: PortableSigner | null
  onPortableSignerChange: (signer: PortableSigner | null) => void
  onRefresh: () => void
}) {
  const [isWorking, setIsWorking] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [walletConnectProjectId, setWalletConnectProjectId] = useState('')
  const [guardians, setGuardians] = useState<HexAddress[]>(walletState?.recovery?.guardians ?? [])
  const [guardianThreshold, setGuardianThreshold] = useState<number>(
    walletState?.recovery?.threshold ?? 2,
  )
  const [customModule, setCustomModule] = useState<HexAddress | undefined>(
    walletState?.recovery?.moduleAddress,
  )
  const [allowCustomModule, setAllowCustomModule] = useState<boolean>(
    walletState?.recovery?.allowUnsafeModule ?? false,
  )
  const recoveryErrorRef = useRef<string | null>(null)

  useEffect(() => {
    setGuardians(walletState?.recovery?.guardians ?? [])
    setGuardianThreshold(walletState?.recovery?.threshold ?? 2)
    setCustomModule(walletState?.recovery?.moduleAddress)
    setAllowCustomModule(walletState?.recovery?.allowUnsafeModule ?? false)
  }, [walletState?.recovery])

  const rpcUrl = chain.rpcUrls[0]
  const bundlerEndpoints = buildBundlerEndpoints(chain)
  const passkey = passkeyForOrigin
  const passkeyCount = walletState?.passkeys?.length ?? 0
  const deployed = walletState?.chainState?.[String(chain.chainId)]?.deployed ?? false
  const rpIdLabel = currentRpId ?? 'this origin'
  const missingPasskeyForOrigin = passkeyCount > 0 && !passkeyForOrigin
  const requiresPortableSigner = missingPasskeyForOrigin && deployed
  const localDevSignerEnabled = !!useLocalDevSigner

  const buildController = useCallback(
    async (options?: { signer?: unknown; useLocalDevSigner?: boolean; providerOverride?: unknown }) => {
      if (!rpcUrl) {
        throw new Error('Add an RPC endpoint in Advanced settings before continuing')
      }

      const shouldUseLocalDevSigner = options?.useLocalDevSigner ?? false
      return new SafeWalletController({
        chain,
        provider: options?.providerOverride ?? rpcUrl,
        signer: options?.signer ?? undefined,
        bundlerEndpoints,
        safeAddress: shouldUseLocalDevSigner ? undefined : safeAddress,
        ...(shouldUseLocalDevSigner ? { ownerConfigOverride: LOCAL_DEV_OWNER_CONFIG } : {}),
      })
    },
    [bundlerEndpoints, chain, rpcUrl, safeAddress],
  )

  const resolvePasskeySignerForChain = useCallback(async () => {
    if (!passkey) {
      throw new Error(`No passkey for ${rpIdLabel}. Sign in with a portable signer to add one.`)
    }

    if (!rpcUrl) {
      throw new Error('Add an RPC endpoint in Advanced settings before continuing')
    }

    const sharedSigner = chain.safeWebAuthnSharedSigner
    const owners = walletState?.ownerConfig?.owners ?? []
    const ownerSet =
      sharedSigner && !owners.some((owner) => owner.toLowerCase() === sharedSigner.toLowerCase())
        ? [...owners, sharedSigner]
        : owners
    const info = await resolvePasskeySigner({
      chain,
      provider: rpcUrl,
      passkey,
      safeAddress,
      owners: ownerSet.length > 0 ? ownerSet : undefined,
    })
    return { signer: info.signer }
  }, [chain, passkey, rpcUrl, rpIdLabel, safeAddress, walletState?.ownerConfig?.owners])

  const resolvePasskeySignerForAddress = useCallback(async () => {
    const candidate = passkeyForOrigin ?? walletState?.passkeys?.[0]
    if (!candidate) {
      throw new Error('Create a passkey before continuing')
    }
    if (!rpcUrl) {
      throw new Error('Add an RPC endpoint in Advanced settings before continuing')
    }

    const sharedSigner = chain.safeWebAuthnSharedSigner
    const owners = walletState?.ownerConfig?.owners ?? []
    const ownerSet =
      sharedSigner && !owners.some((owner) => owner.toLowerCase() === sharedSigner.toLowerCase())
        ? [...owners, sharedSigner]
        : owners
    const info = await resolvePasskeySigner({
      chain,
      provider: rpcUrl,
      passkey: candidate,
      safeAddress,
      owners: ownerSet.length > 0 ? ownerSet : undefined,
    })
    return { signer: info.signer }
  }, [chain, passkeyForOrigin, rpcUrl, safeAddress, walletState?.ownerConfig?.owners, walletState?.passkeys])

  const resolvePortableSignerForChain = useCallback(async () => {
    if (!isPortableSignerConnection(portableSigner)) {
      throw new Error('Connect a portable signer before continuing')
    }
    await assertProviderChain(portableSigner.provider, chain)
    return { signer: portableSigner.address, providerOverride: portableSigner.provider }
  }, [chain, portableSigner])

  const resolveActiveSignerForChain = useCallback(async () => {
    if (localDevSignerEnabled) {
      return { signer: LOCAL_DEV_PRIVATE_KEY }
    }
    if (passkeyForOrigin) {
      return resolvePasskeySignerForChain()
    }
    if (portableSigner) {
      return resolvePortableSignerForChain()
    }

    if (passkeyCount > 0) {
      throw new Error(`No passkey for ${rpIdLabel}. Sign in with a portable signer to add one.`)
    }

    throw new Error('Create a passkey before continuing')
  }, [
    localDevSignerEnabled,
    passkeyCount,
    passkeyForOrigin,
    portableSigner,
    resolvePasskeySignerForChain,
    resolvePortableSignerForChain,
    rpIdLabel,
  ])

  const handleCreatePasskey = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      if (requiresPortableSigner) {
        throw new Error(`Connect a portable signer to add a passkey for ${rpIdLabel}.`)
      }
      const controller = await buildController()
      await controller.createPasskeySigner()
      setStatus('Passkey created. Ready to compute your wallet address.')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create passkey')
    } finally {
      setIsWorking(false)
    }
  }, [buildController, onRefresh, requiresPortableSigner, rpIdLabel])

  const handleAddPasskeyForOrigin = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      if (!safeAddress) {
        throw new Error('Generate and deploy your Safe before adding a new passkey.')
      }
      const signerInfo = await resolvePortableSignerForChain()
      const controller = await buildController(signerInfo)
      const metadata = await createPasskeyMetadata({ rpId: currentRpId })
      await controller.addPasskeyOwner(metadata)
      setStatus(`Passkey added for ${rpIdLabel}.`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add passkey for this origin')
    } finally {
      setIsWorking(false)
    }
  }, [
    buildController,
    currentRpId,
    onRefresh,
    resolvePortableSignerForChain,
    rpIdLabel,
    safeAddress,
  ])

  const handleGenerateAddress = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      const signerInfo = localDevSignerEnabled
        ? { signer: LOCAL_DEV_PRIVATE_KEY }
        : await resolvePasskeySignerForAddress()
      const controller = await buildController({
        ...signerInfo,
        useLocalDevSigner: localDevSignerEnabled,
      })
      const address = await controller.getCounterfactualAddress()
      setStatus(`Address ready: ${formatAddress(address)}`)
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compute address')
    } finally {
      setIsWorking(false)
    }
  }, [buildController, localDevSignerEnabled, onRefresh, resolvePasskeySignerForAddress])

  const handleCheckDeployment = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      const signerInfo = localDevSignerEnabled
        ? { signer: LOCAL_DEV_PRIVATE_KEY }
        : await resolvePasskeySignerForAddress()
      const controller = await buildController({
        ...signerInfo,
        useLocalDevSigner: localDevSignerEnabled,
      })
      const deployed = await controller.isDeployed()
      setStatus(deployed ? 'Safe is deployed onchain.' : 'Safe not deployed yet.')
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check deployment')
    } finally {
      setIsWorking(false)
    }
  }, [buildController, localDevSignerEnabled, onRefresh, resolvePasskeySignerForAddress])

  const handleConnectInjected = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      const signer = await connectInjectedSigner()
      onPortableSignerChange(signer)
      setStatus(`Connected ${formatAddress(signer.address)}. Ready to add as owner.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect injected wallet')
    } finally {
      setIsWorking(false)
    }
  }, [])

  const handleConnectWalletConnect = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      const projectId = walletConnectProjectId.trim()
      if (!projectId) {
        throw new Error('WalletConnect project ID is required')
      }

      const signer = await connectWalletConnectSigner({
        projectId,
        chains: [chain.chainId],
        optionalChains: [],
        showQrModal: true,
        metadata: {
          name: 'Demo Wallet',
          description: 'Demo smart account onboarding',
          url: typeof window !== 'undefined' ? window.location.origin : 'https://demo.fm',
          icons: [],
        },
      })
      onPortableSignerChange(signer)
      setStatus(`Connected ${formatAddress(signer.address)}. Ready to add as owner.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect WalletConnect')
    } finally {
      setIsWorking(false)
    }
  }, [chain.chainId, walletConnectProjectId])

  const handleCreateLocalSigner = useCallback(() => {
    const signer = createLocalSigner()
    onPortableSignerChange(signer)
    setStatus(`Created local signer ${formatAddress(signer.address)}.`)
  }, [])

  const handleAddPortableOwner = useCallback(async () => {
    if (!portableSigner) {
      const message = 'Connect a portable signer first'
      setError(message)
      toast.error(message)
      return
    }

    setIsWorking(true)
    setError(null)
    setStatus(null)
    try {
      const signerInfo = await resolveActiveSignerForChain()
      const controller = await buildController({
        ...signerInfo,
        useLocalDevSigner: localDevSignerEnabled,
      })
      await controller.addPortableOwner(portableSigner.address)
      const message = 'Portable signer added to owners.'
      setStatus(message)
      toast.success(message)
      onRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add portable owner'
      setError(message)
      toast.error(message)
    } finally {
      setIsWorking(false)
    }
  }, [buildController, localDevSignerEnabled, onRefresh, portableSigner, resolveActiveSignerForChain])

  const handleSetupRecovery = useCallback(async () => {
    setIsWorking(true)
    setError(null)
    setStatus(null)
    recoveryErrorRef.current = null

    try {
      const signerInfo = await resolveActiveSignerForChain()
      const controller = await buildController({
        ...signerInfo,
        useLocalDevSigner: localDevSignerEnabled,
      })
      await controller.setupRecovery({
        guardians,
        threshold: guardianThreshold,
        moduleAddress: customModule,
        allowUnsafeModule: allowCustomModule,
      })
      setStatus('Recovery module configured.')
      onRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to configure recovery'
      setError(message)
      recoveryErrorRef.current = message
    } finally {
      setIsWorking(false)
    }
  }, [
    allowCustomModule,
    buildController,
    customModule,
    guardianThreshold,
    guardians,
    localDevSignerEnabled,
    onRefresh,
    resolveActiveSignerForChain,
  ])

  return (
    <div className="flex flex-col gap-6" data-part="wallet-onboarding">
      <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-sky-200" />
          </div>
          <div className="flex-1">
            <h4 className="text-base font-semibold text-gray-100">Passkey-first onboarding</h4>
            <p className="text-sm text-gray-400">
              Create a passkey, generate your counterfactual address, then add a backup signer.
            </p>
          </div>
        </div>
        {requiresPortableSigner && (
          <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            No passkey is registered for {rpIdLabel}. Sign in with a portable signer to add one.
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleCreatePasskey}
            disabled={isWorking || requiresPortableSigner}
            className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary} flex items-center gap-2 disabled:opacity-60`}
          >
            {isWorking ? <Loader2 className="w-4 h-4 animate-spin" /> : <BadgeCheck className="w-4 h-4" />}
            Create passkey
          </button>
          <button
            type="button"
            onClick={handleGenerateAddress}
            disabled={isWorking || ((passkeyCount === 0) && !localDevSignerEnabled)}
            className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyActive} flex items-center gap-2 disabled:opacity-60`}
          >
            <ArrowRight className="w-4 h-4" />
            Generate address
          </button>
          <button
            type="button"
            onClick={handleCheckDeployment}
            disabled={isWorking || ((passkeyCount === 0) && !localDevSignerEnabled)}
            className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyMuted} flex items-center gap-2 disabled:opacity-60`}
          >
            <RefreshCw className={`w-4 h-4 ${isWorking ? 'animate-spin' : ''}`} />
            Check deployment
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Need test funds? Send ETH/USDC to the counterfactual address to deploy on first action.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-violet-200" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-gray-100">Portable signer (backup)</h4>
              <p className="text-sm text-gray-400">
                Add a mobile or browser wallet as a recovery-friendly backup owner.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <button
              type="button"
              onClick={handleConnectInjected}
              disabled={isWorking}
              className={`px-4 py-2 text-sm font-medium rounded-xl ${glassyBase} ${glassyActive}`}
            >
              Connect injected wallet
            </button>
            <div className="flex flex-col gap-2">
              <input
                type="text"
                value={walletConnectProjectId}
                onChange={(event) => setWalletConnectProjectId(event.target.value)}
                placeholder="WalletConnect project ID"
                className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
              />
              <button
                type="button"
                onClick={handleConnectWalletConnect}
                disabled={isWorking}
                className={`px-4 py-2 text-sm font-medium rounded-xl ${glassyBase} ${glassyNeutral}`}
              >
                Connect WalletConnect
              </button>
            </div>
            <button
              type="button"
              onClick={handleCreateLocalSigner}
              className={`px-4 py-2 text-sm font-medium rounded-xl ${glassyBase} ${glassyMuted}`}
            >
              Create local signer (advanced)
            </button>
          </div>
          {portableSigner && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Connected</p>
                <p className="text-sm font-mono text-gray-200">{portableSigner.address}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleAddPortableOwner}
                  disabled={isWorking}
                  className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary}`}
                >
                  Add owner
                </button>
                {requiresPortableSigner && (
                  <button
                    type="button"
                    onClick={handleAddPasskeyForOrigin}
                    disabled={isWorking || !deployed || !isPortableSignerConnection(portableSigner)}
                    className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyActive}`}
                  >
                    Add passkey for {rpIdLabel}
                  </button>
                )}
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Adding a portable owner requires the Safe to be deployed onchain.
          </p>
        </div>

        <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-gray-100">Optional guardians</h4>
              <p className="text-sm text-gray-400">
                Configure guardian-based recovery once you have guardians ready.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <RecoverySetupPanel
              guardians={guardians}
              threshold={guardianThreshold}
              moduleAddress={customModule}
              allowCustomModule={allowCustomModule}
              onGuardiansChange={setGuardians}
              onThresholdChange={setGuardianThreshold}
              onModuleAddressChange={setCustomModule}
              onAllowCustomModuleChange={setAllowCustomModule}
              error={recoveryErrorRef.current ?? undefined}
            />
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={handleSetupRecovery}
              disabled={isWorking}
              className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary}`}
            >
              Install recovery module
            </button>
          </div>
        </div>
      </div>

      {(status || error) && (
        <div
          className={`p-4 rounded-2xl border ${glassyBase} ${
            error ? 'border-red-500/40 text-red-200/90' : 'border-emerald-400/40 text-emerald-100'
          }`}
        >
          {error ?? status}
        </div>
      )}

      <details
        className={`rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}
        data-part="advanced-settings"
      >
        <summary className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center">
              <Settings2 className="w-5 h-5 text-indigo-200" />
            </div>
            <div>
              <h4 className="text-base font-semibold text-gray-100">Advanced</h4>
              <p className="text-sm text-gray-400">
                Endpoints, backups, and local dev overrides.
              </p>
            </div>
          </div>
          <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Toggle</span>
        </summary>
        <div className="px-5 pb-5">
          <WalletSettingsPanel chain={chain} walletState={walletState} onRefresh={onRefresh} />
        </div>
      </details>
    </div>
  )
}

function WalletPurchasePanel({
  chain,
  walletState,
  safeAddress,
  useLocalDevSigner,
  currentRpId,
  passkeyForOrigin,
  portableSigner,
  onRefresh,
}: {
  chain: ChainConfig
  walletState: WalletState | null
  safeAddress?: HexAddress
  useLocalDevSigner?: boolean
  currentRpId?: string
  passkeyForOrigin: PasskeyMetadata | null
  portableSigner: PortableSigner | null
  onRefresh: () => void
}) {
  const [mode, setMode] = useState<'transfer' | 'approve-call'>('transfer')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [spender, setSpender] = useState('')
  const [callTarget, setCallTarget] = useState('')
  const [callData, setCallData] = useState('0x')
  const [amount, setAmount] = useState('')
  const [flowStep, setFlowStep] = useState<'form' | 'review'>('form')
  const [approvalUnlimited, setApprovalUnlimited] = useState(true)
  const [paymasterMode, setPaymasterMode] = useState<PaymasterMode>('auto')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [requiresOverride, setRequiresOverride] = useState(false)
  const [simulationError, setSimulationError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleToggleAdvanced = useCallback(() => {
    setShowAdvanced((prev) => {
      const next = !prev
      setMode(next ? 'approve-call' : 'transfer')
      return next
    })
  }, [])

  useEffect(() => {
    if (!showAdvanced && mode === 'approve-call') {
      setMode('transfer')
    }
  }, [mode, showAdvanced])

  const rpcUrl = chain.rpcUrls[0]
  const bundlerUrls = chain.bundlerUrls ?? []
  const passkey = passkeyForOrigin
  const passkeyCount = walletState?.passkeys?.length ?? 0
  const rpIdLabel = currentRpId ?? 'this origin'
  const tokenAddress = chain.circlePaymasterToken
  const localDevSignerEnabled = !!useLocalDevSigner

  const preview = useMemo(() => {
    if (!tokenAddress || !amount) {
      return null
    }

    const parsed = parseAmount(amount)
    if (!parsed) return null

    return {
      token: tokenAddress,
      amount: parsed,
      amountLabel: formatUnits(parsed, 6),
      spender: mode === 'approve-call' ? spender : recipient,
      isUnlimited: approvalUnlimited && mode === 'approve-call',
    }
  }, [amount, approvalUnlimited, mode, recipient, spender, tokenAddress])

  const resolvePasskeySignerForChain = useCallback(async () => {
    if (!passkey) {
      throw new Error(`No passkey for ${rpIdLabel}. Sign in with a portable signer to continue.`)
    }
    if (!rpcUrl) {
      throw new Error('Add an RPC endpoint in Advanced settings before sending transactions')
    }

    const sharedSigner = chain.safeWebAuthnSharedSigner
    const owners = walletState?.ownerConfig?.owners ?? []
    const ownerSet =
      sharedSigner && !owners.some((owner) => owner.toLowerCase() === sharedSigner.toLowerCase())
        ? [...owners, sharedSigner]
        : owners
    const info = await resolvePasskeySigner({
      chain,
      provider: rpcUrl,
      passkey,
      safeAddress,
      owners: ownerSet.length > 0 ? ownerSet : undefined,
    })
    return { signer: info.signer }
  }, [chain, passkey, rpcUrl, rpIdLabel, safeAddress, walletState?.ownerConfig?.owners])

  const resolvePortableSignerForChain = useCallback(async () => {
    if (!isPortableSignerConnection(portableSigner)) {
      throw new Error('Sign in with a portable signer before sending transactions')
    }
    await assertProviderChain(portableSigner.provider, chain)
    return { signer: portableSigner.address, providerOverride: portableSigner.provider }
  }, [chain, portableSigner])

  const resolveActiveSignerForChain = useCallback(async () => {
    if (localDevSignerEnabled) {
      return { signer: LOCAL_DEV_PRIVATE_KEY }
    }
    if (passkeyForOrigin) {
      return resolvePasskeySignerForChain()
    }
    if (portableSigner) {
      return resolvePortableSignerForChain()
    }

    if (passkeyCount > 0) {
      throw new Error(`No passkey for ${rpIdLabel}. Sign in with a portable signer to continue.`)
    }

    throw new Error('Create a passkey before sending transactions')
  }, [
    localDevSignerEnabled,
    passkeyCount,
    passkeyForOrigin,
    portableSigner,
    resolvePasskeySignerForChain,
    resolvePortableSignerForChain,
    rpIdLabel,
  ])

  const buildController = useCallback(
    async (options?: { signer?: unknown; useLocalDevSigner?: boolean; providerOverride?: unknown }) => {
    if (!rpcUrl) {
      throw new Error('Add an RPC endpoint in Advanced settings before sending transactions')
    }

      const shouldUseLocalDevSigner = options?.useLocalDevSigner ?? false
      return new SafeWalletController({
        chain,
        provider: options?.providerOverride ?? rpcUrl,
        signer: options?.signer ?? undefined,
        bundlerEndpoints: buildBundlerEndpoints(chain),
        safeAddress: shouldUseLocalDevSigner ? undefined : safeAddress,
        ...(shouldUseLocalDevSigner ? { ownerConfigOverride: LOCAL_DEV_OWNER_CONFIG } : {}),
      })
    },
    [chain, rpcUrl, safeAddress],
  )

  const buildCalls = useCallback((): { calls: ReturnType<typeof buildApproveAndCallBatch> } => {
    if (!tokenAddress) {
      throw new Error('USDC token address missing for this chain')
    }

    const parsedAmount = parseAmount(amount)
    if (!parsedAmount) {
      throw new Error('Enter a valid amount')
    }

    if (mode === 'transfer') {
      if (!recipient) {
        throw new Error('Recipient address is required')
      }

      return {
        calls: [
          {
            to: tokenAddress,
            data: encodeFunctionData({
              abi: ERC20_TRANSFER_ABI,
              functionName: 'transfer',
              args: [recipient as HexAddress, parsedAmount],
            }),
            value: 0n,
          },
        ],
      }
    }

    if (!spender || !callTarget) {
      throw new Error('Spender and contract target are required')
    }

    const approveAmount = approvalUnlimited ? undefined : parsedAmount

    return {
      calls: buildApproveAndCallBatch({
        token: tokenAddress,
        spender: spender as HexAddress,
        amount: approveAmount,
        call: {
          to: callTarget as HexAddress,
          data: ensureHex(callData),
          value: 0n,
        },
      }),
    }
  }, [amount, approvalUnlimited, callData, callTarget, mode, recipient, spender, tokenAddress])

  const runSimulation = useCallback(async () => {
    setSimulationError(null)
    if (!rpcUrl) {
      const message = 'Add an RPC endpoint in Advanced settings to simulate calls'
      setSimulationError(message)
      toast.error(message)
      return
    }

    let calls
    try {
      calls = buildCalls().calls
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid transaction data'
      setSimulationError(message)
      toast.error(message)
      return
    }

    try {
      let simulationAddress = safeAddress
      if (localDevSignerEnabled) {
        const signerInfo = await resolveActiveSignerForChain()
        const controller = await buildController({
          ...signerInfo,
          useLocalDevSigner: true,
        })
        simulationAddress = await controller.getCounterfactualAddress()
      }

      if (!simulationAddress) {
        const message = 'Generate a wallet address before simulating'
        setSimulationError(message)
        toast.error(message)
        return
      }

      const client = createPublicClient({ transport: http(rpcUrl) })
      for (const call of calls) {
        await client.call({
          to: call.to,
          data: call.data ?? '0x',
          value: call.value ?? 0n,
          account: simulationAddress,
        })
      }
      setSimulationError(null)
      toast.success('Simulation succeeded')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Simulation failed; review before submitting'
      setSimulationError(message)
      toast.error(message)
    }
  }, [
    buildCalls,
    buildController,
    localDevSignerEnabled,
    resolveActiveSignerForChain,
    rpcUrl,
    safeAddress,
  ])

  const canAdvance = useMemo(() => {
    try {
      buildCalls()
      return true
    } catch {
      return false
    }
  }, [buildCalls])

  const handleAdvance = useCallback(() => {
    setError(null)
    setResult(null)
    setSimulationError(null)
    setRequiresOverride(false)
    if (!canAdvance) {
      return
    }
    setFlowStep('review')
  }, [canAdvance])

  const handleBack = useCallback(() => {
    setError(null)
    setResult(null)
    setSimulationError(null)
    setRequiresOverride(false)
    setFlowStep('form')
  }, [])

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true)
    setError(null)
    setResult(null)

    try {
      if (bundlerUrls.length === 0) {
        throw new Error('Add a bundler endpoint in Advanced settings before submitting')
      }

      if (simulationError && !requiresOverride) {
        throw new Error('Simulation failed; confirm override to continue')
      }

      const signerInfo = await resolveActiveSignerForChain()
      const controller = await buildController({
        ...signerInfo,
        useLocalDevSigner: localDevSignerEnabled,
      })
      controller.setPaymasterMode(paymasterMode)

      const { calls } = buildCalls()
      const response = await controller.sendCalls(calls)
      const status = response.paymasterStatus
      const statusLabel = status
        ? `${status.resolvedMode.toUpperCase()} gas (${status.label})`
        : 'UserOperation submitted'

      const message = `Sent UserOperation ${response.userOpHash}. ${statusLabel}.`
      setResult(message)
      toast.success(message)
      onRefresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit purchase'
      setError(message)
      toast.error(message)
    } finally {
      setIsSubmitting(false)
    }
  }, [
    buildCalls,
    buildController,
    bundlerUrls.length,
    localDevSignerEnabled,
    onRefresh,
    paymasterMode,
    requiresOverride,
    resolveActiveSignerForChain,
    simulationError,
  ])

  return (
    <div className="flex flex-col gap-6" data-part="wallet-purchase">
      {(localDevSignerEnabled || (!passkey && passkeyCount > 0 && !localDevSignerEnabled && !portableSigner)) && (
        <div className="flex flex-col gap-2 text-xs text-amber-200/90">
          {localDevSignerEnabled && (
            <p>
              Local dev signer enabled. Submissions will use the Hardhat default owner instead of a passkey.
            </p>
          )}
          {!passkey && passkeyCount > 0 && !localDevSignerEnabled && !portableSigner && (
            <p>
              No passkey is registered for {rpIdLabel}. Connect a portable signer in Onboarding to continue.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {flowStep === 'form' && (
          <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {showAdvanced && (
                  <button
                    type="button"
                    onClick={() => setMode('approve-call')}
                    className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${
                      mode === 'approve-call' ? glassyActive : glassyMuted
                    }`}
                  >
                    Approve + call
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={handleToggleAdvanced}
                aria-pressed={showAdvanced}
                className="advanced-toggle text-[7px] leading-none font-medium uppercase tracking-[0.25em] text-gray-500 hover:text-gray-200 transition-colors"
              >
                {showAdvanced ? 'Back' : 'Advanced'}
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-xs uppercase tracking-[0.2em] text-gray-500">USDC amount</label>
              <input
                type="text"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
              />

              {mode === 'transfer' ? (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Recipient</label>
                  <input
                    type="text"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder="0x recipient"
                    className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
                  />
                </>
              ) : (
                <>
                  <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Spender</label>
                  <input
                    type="text"
                    value={spender}
                    onChange={(event) => setSpender(event.target.value)}
                    placeholder="0x spender"
                    className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
                  />

                  <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Contract</label>
                  <input
                    type="text"
                    value={callTarget}
                    onChange={(event) => setCallTarget(event.target.value)}
                    placeholder="0x contract target"
                    className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
                  />

                  <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Call data</label>
                  <textarea
                    value={callData}
                    onChange={(event) => setCallData(event.target.value)}
                    placeholder="0x..."
                    rows={3}
                    className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10 font-mono"
                  />

                  <label className="flex items-center gap-2 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={approvalUnlimited}
                      onChange={(event) => setApprovalUnlimited(event.target.checked)}
                      className="rounded border-white/20 bg-gray-900"
                    />
                    Unlimited approval (recommended for subscriptions)
                  </label>
                </>
              )}
            </div>

            <details className={`mt-4 rounded-2xl border border-white/10 ${glassyBase} ${glassyMuted}`}>
              <summary className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer list-none">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Advanced</span>
                <span className="text-xs text-gray-400">Paymaster options</span>
              </summary>
              <div className="px-4 pb-4 grid gap-3">
                <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Paymaster mode</label>
                <div className="flex flex-wrap gap-2">
                  {(['auto', 'usdc', 'sponsored', 'native'] as PaymasterMode[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPaymasterMode(value)}
                      className={`px-4 py-1.5 text-xs font-medium rounded-full ${glassyBase} ${
                        paymasterMode === value ? glassyActive : glassyMuted
                      }`}
                    >
                      {value.toUpperCase()}
                    </button>
                  ))}
                </div>
                <div className="text-xs text-gray-400 leading-relaxed">
                  <div>Auto: let the wallet choose the best available gas mode.</div>
                  <div>USDC: pay gas in USDC via the configured paymaster.</div>
                  <div>Sponsored: gas is covered by a sponsor paymaster.</div>
                  <div>Native: pay gas in ETH from the Safe.</div>
                </div>
              </div>
            </details>

            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                Review details before signing and sending.
              </p>
              <button
                type="button"
                onClick={handleAdvance}
                disabled={!canAdvance}
                className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary} flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                Review transaction
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {flowStep === 'review' && (
          <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-sky-200" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-gray-100">Review &amp; send</h4>
                  <p className="text-sm text-gray-400">
                    Confirm details, optionally simulate, then submit.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleBack}
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] rounded-full ${glassyBase} ${glassyMuted}`}
              >
                Back
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Token</span>
                <span className="text-gray-100 font-mono">{tokenAddress ?? '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Amount</span>
                <span className="text-gray-100">
                  {preview ? `${preview.amountLabel} USDC` : '--'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-gray-500">Spender</span>
                <span className="text-gray-100 font-mono">
                  {preview?.spender ? formatAddress(preview.spender) : '--'}
                </span>
              </div>
              {preview?.isUnlimited && (
                <div className={`p-3 rounded-xl border border-amber-400/40 ${glassyBase} ${glassyMuted}`}>
                  <p className="text-xs text-amber-100/80">
                    Unlimited approval grants ongoing spending access. Only approve trusted contracts.
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <button
                type="button"
                onClick={runSimulation}
                className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyNeutral}`}
              >
                Run simulation
              </button>
              {simulationError && (
                <label className="flex items-center gap-2 text-xs text-amber-200/80">
                  <input
                    type="checkbox"
                    checked={requiresOverride}
                    onChange={(event) => setRequiresOverride(event.target.checked)}
                    className="rounded border-white/20 bg-gray-900"
                  />
                  Simulation failed: {simulationError}. Check to continue anyway.
                </label>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary} flex items-center justify-center gap-2 disabled:opacity-60`}
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                Submit UserOp
              </button>
            </div>
          </div>
        )}
      </div>

      {(error || result) && (
        <div
          className={`p-4 rounded-2xl border ${glassyBase} ${
            error ? 'border-red-500/40 text-red-200/90' : 'border-emerald-400/40 text-emerald-100'
          }`}
        >
          {error ?? result}
        </div>
      )}
    </div>
  )
}

function WalletSettingsPanel({
  chain,
  walletState,
  onRefresh,
}: {
  chain: ChainConfig
  walletState: WalletState | null
  onRefresh: () => void
}) {
  const chainKey = String(chain.chainId)
  const [bundlerUrls, setBundlerUrls] = useState((chain.bundlerUrls ?? []).join('\n'))
  const [rpcUrls, setRpcUrls] = useState(chain.rpcUrls.join('\n'))
  const [useLocalDevSigner, setUseLocalDevSigner] = useState(
    walletState?.overrides?.[chainKey]?.useLocalDevSigner ?? false,
  )
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isLocalChain = chain.chainId === 31337

  useEffect(() => {
    setBundlerUrls((chain.bundlerUrls ?? []).join('\n'))
    setRpcUrls(chain.rpcUrls.join('\n'))
  }, [chain.bundlerUrls, chain.rpcUrls])

  useEffect(() => {
    setUseLocalDevSigner(walletState?.overrides?.[chainKey]?.useLocalDevSigner ?? false)
  }, [chainKey, walletState?.overrides])

  const handleSaveOverrides = useCallback(async () => {
    const bundlers = normalizeUrls(bundlerUrls)
    const rpcs = normalizeUrls(rpcUrls)

    await setChainOverrides({
      chainId: chain.chainId,
      overrides: {
        bundlerUrls: bundlers,
        rpcUrls: rpcs,
        ...(isLocalChain ? { useLocalDevSigner } : {}),
      },
    })
    onRefresh()
  }, [bundlerUrls, chain.chainId, isLocalChain, onRefresh, rpcUrls, useLocalDevSigner])

  const downloadJson = useCallback((data: object, label: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = label
    link.click()
    URL.revokeObjectURL(url)
  }, [])

  const handleExport = useCallback(async () => {
    setExportStatus(null)
    if (!walletState) {
      setExportStatus('Nothing to export yet.')
      return
    }

    if (!exportPassphrase) {
      downloadJson(
        {
          version: 1,
          encrypted: false,
          payload: walletState,
          exportedAt: new Date().toISOString(),
        },
        `demo-wallet-${chain.chainId}.json`,
      )
      setExportStatus('Exported unencrypted metadata.')
      return
    }

    const crypto = await createStorageCrypto(new TextEncoder().encode(exportPassphrase))
    const encrypted = await crypto.encrypt(JSON.stringify(walletState))

    downloadJson(
      {
        version: 1,
        encrypted: true,
        payload: encrypted,
        exportedAt: new Date().toISOString(),
      },
      `demo-wallet-${chain.chainId}.encrypted.json`,
    )
    setExportStatus('Exported encrypted metadata.')
  }, [chain.chainId, downloadJson, exportPassphrase, walletState])

  const handleImport = useCallback(async () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return

    setImportError(null)

    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as {
        encrypted?: boolean
        payload?: unknown
      }

      let payload = parsed.payload
      if (parsed.encrypted) {
        if (!importPassphrase) {
          throw new Error('Passphrase required to import encrypted backup')
        }
        const crypto = await createStorageCrypto(new TextEncoder().encode(importPassphrase))
        const decrypted = await crypto.decrypt(parsed.payload as EncryptedPayload)
        payload = JSON.parse(decrypted)
      }

      if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid wallet export format')
      }

      await setWalletState(payload as WalletStatePayload)
      await onRefresh()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import wallet state')
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [importPassphrase, onRefresh])

  return (
    <div className="flex flex-col gap-6" data-part="wallet-settings">
      <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <Settings2 className="w-5 h-5 text-indigo-200" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-gray-100">Endpoints</h4>
            <p className="text-sm text-gray-400">
              Override RPC and bundler endpoints. One URL per line.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Bundlers</label>
            <textarea
              value={bundlerUrls}
              onChange={(event) => setBundlerUrls(event.target.value)}
              rows={3}
              className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-gray-500">RPC URLs</label>
            <textarea
              value={rpcUrls}
              onChange={(event) => setRpcUrls(event.target.value)}
              rows={3}
              className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
            />
          </div>
          {isLocalChain && (
            <div className="flex flex-col gap-2">
              <label className="text-xs uppercase tracking-[0.2em] text-gray-500">
                Local dev signer
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={useLocalDevSigner}
                  onChange={(event) => setUseLocalDevSigner(event.target.checked)}
                  className="mt-1 rounded border-white/20 bg-gray-900"
                />
                <span>
                  Use the Hardhat default owner for local UserOps (matches the bundler smoke test).
                </span>
              </label>
              <p className="text-xs text-gray-400">
                This bypasses passkey ownership for local testing and uses the known dev private key.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleSaveOverrides}
            className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyPrimary} flex items-center gap-2`}
          >
            <SaveIcon />
            Save overrides
          </button>
        </div>
      </div>

      <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-200" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-gray-100">Backups</h4>
            <p className="text-sm text-gray-400">
              Export wallet metadata for safekeeping. Encryption uses a passphrase you control.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-gray-500">
              Export passphrase (optional)
            </label>
            <input
              type="password"
              value={exportPassphrase}
              onChange={(event) => setExportPassphrase(event.target.value)}
              placeholder="Leave blank for plain JSON"
              className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
            />
            <button
              type="button"
              onClick={handleExport}
              className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyActive}`}
            >
              Export metadata
            </button>
            {exportStatus && <p className="text-xs text-emerald-200">{exportStatus}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-[0.2em] text-gray-500">Import backup</label>
            <input
              type="password"
              value={importPassphrase}
              onChange={(event) => setImportPassphrase(event.target.value)}
              placeholder="Passphrase for encrypted backups"
              className="px-3 py-2 rounded-xl text-sm text-gray-100 bg-gray-900/70 border border-white/10"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input ref={fileInputRef} type="file" accept="application/json" />
              <button
                type="button"
                onClick={handleImport}
                className={`px-4 py-2 text-sm font-medium rounded-full ${glassyBase} ${glassyNeutral}`}
              >
                Import
              </button>
            </div>
            {importError && <p className="text-xs text-red-300">{importError}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

function WalletActivityPanel({
  chain,
  walletState,
  safeAddress,
}: {
  chain: ChainConfig
  walletState: WalletState | null
  safeAddress?: HexAddress
}) {
  const [items, setItems] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rpcUrl = chain.rpcUrls[0]

  const handleLoad = useCallback(async () => {
    setError(null)
    setIsLoading(true)

    try {
      if (!rpcUrl) {
        throw new Error('Add an RPC endpoint in Advanced settings to load activity')
      }
      if (!safeAddress) {
        throw new Error('Generate a wallet address first')
      }

      const client = createPublicClient({ transport: http(rpcUrl) })
      const latestBlock = await client.getBlockNumber()
      const fromBlock = latestBlock > 50_000n ? latestBlock - 50_000n : 0n

      const userOps = await client.getLogs({
        address: chain.entryPoint,
        event: ENTRYPOINT_USEROP_EVENT,
        args: { sender: safeAddress },
        fromBlock,
      })

      const tokenAddress = chain.circlePaymasterToken
      const transferLogs = tokenAddress
        ? await Promise.all([
            client.getLogs({
              address: tokenAddress,
              event: ERC20_TRANSFER_EVENT,
              args: { from: safeAddress },
              fromBlock,
            }),
            client.getLogs({
              address: tokenAddress,
              event: ERC20_TRANSFER_EVENT,
              args: { to: safeAddress },
              fromBlock,
            }),
          ])
        : [[], []]

      const transferOut = transferLogs[0].map((log) =>
        buildTransferItem(log, 'sent', tokenAddress ?? '0x'),
      )
      const transferIn = transferLogs[1].map((log) =>
        buildTransferItem(log, 'received', tokenAddress ?? '0x'),
      )

      const userOpItems = userOps.map((log) => ({
        id: `${log.transactionHash}-${log.logIndex}`,
        type: 'userop' as const,
        label: log.args?.success ? 'UserOp succeeded' : 'UserOp failed',
        txHash: log.transactionHash as HexData,
        detail: `Nonce ${log.args?.nonce?.toString() ?? '--'}`,
        blockNumber: log.blockNumber,
      }))

      const merged = [...userOpItems, ...transferOut, ...transferIn].sort((a, b) =>
        (b.blockNumber ?? 0n) > (a.blockNumber ?? 0n) ? 1 : -1,
      )

      setItems(merged)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setIsLoading(false)
    }
  }, [chain.circlePaymasterToken, chain.entryPoint, rpcUrl, safeAddress])

  useEffect(() => {
    if (walletState) {
      void handleLoad()
    }
  }, [handleLoad, walletState])

  return (
    <div className="flex flex-col gap-6" data-part="wallet-activity">
      <div className={`p-5 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral}`}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center">
            <ActivityIcon className="w-5 h-5 text-sky-200" />
          </div>
          <div>
            <h4 className="text-base font-semibold text-gray-900">Activity feed</h4>
            <p className="text-sm text-gray-600">
              Shows recent UserOperations and USDC transfers (best-effort).
            </p>
          </div>
        </div>
        {error && <p className="mt-4 text-xs text-red-300">{error}</p>}
      </div>

      <div className="flex flex-col gap-3">
        {items.length === 0 && !isLoading && (
          <div className={`p-4 rounded-2xl border border-white/10 ${glassyBase} ${glassyMuted}`}>
            <p className="text-sm text-gray-400">No activity yet.</p>
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`p-4 rounded-2xl border border-white/10 ${glassyBase} ${glassyNeutral} flex items-center justify-between gap-3`}
          >
            <div>
              {item.type === 'transfer' && item.tokenSymbol && item.amountLabel && item.direction ? (
                <p className="text-sm font-medium text-gray-200">
                  <span className="inline-flex items-center rounded-full bg-emerald-100/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">
                    {item.tokenSymbol}
                  </span>
                  <span className="ml-2 text-gray-900">
                    {item.direction === 'sent' ? 'sent' : 'received'} {item.amountLabel}
                  </span>
                </p>
              ) : (
                <p className="text-sm font-medium text-gray-200">{item.label}</p>
              )}
              {item.detail && (
                <p
                  className={`text-xs ${
                    item.type === 'transfer' ? 'text-emerald-900/70' : 'text-gray-500'
                  }`}
                >
                  {item.detail}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono">{formatAddress(item.txHash)}</span>
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type ActivityItem = {
  id: string
  type: 'userop' | 'transfer'
  label: string
  detail?: string
  txHash?: HexData
  blockNumber?: bigint
  tokenSymbol?: string
  tokenAddress?: string
  amountLabel?: string
  direction?: 'sent' | 'received'
}

const buildTransferItem = (
  log: {
    transactionHash?: HexData
    logIndex: number
    args?: { value?: bigint }
    blockNumber?: bigint
  },
  direction: 'sent' | 'received',
  tokenAddress: string,
): ActivityItem => {
  const amount = log.args?.value ?? 0n
  const formatted = formatUnits(amount, 6)

  return {
    id: `${log.transactionHash}-${log.logIndex}`,
    type: 'transfer',
    label: `${direction === 'sent' ? 'USDC sent' : 'USDC received'} ${formatted}`,
    detail: `Token ${formatAddress(tokenAddress)}`,
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    tokenSymbol: 'USDC',
    tokenAddress,
    amountLabel: formatted,
    direction,
  }
}

const parseAmount = (value: string): bigint | null => {
  if (!value) return null
  try {
    return parseUnits(value, 6)
  } catch {
    return null
  }
}

const ensureHex = (value: string): HexData => {
  if (!value) {
    return '0x'
  }

  if (value.startsWith('0x')) {
    return value as HexData
  }

  return `0x${value}` as HexData
}

function SaveIcon() {
  return (
    <span className="relative flex items-center justify-center w-4 h-4">
      <span className="absolute inset-0 rounded-full bg-sky-200/20" />
      <Plus className="w-3.5 h-3.5 text-sky-200" />
    </span>
  )
}

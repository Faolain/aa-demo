import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'
import Safe, { PREDETERMINED_SALT_NONCE } from '@safe-global/protocol-kit'
import {
  Safe4337Pack,
  SafeOperationFactory,
  createBundlerClient,
  createUserOperation,
} from '@safe-global/relay-kit'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const HARDHAT_MNEMONIC =
  process.env.LOCAL_MNEMONIC ??
  'test test test test test test test test test test test junk'
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545'
const DEFAULT_BUNDLER_URL = 'http://127.0.0.1:14337/rpc'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')

type LocalDeployments = {
  rpcUrl?: string
  bundlerUrl?: string
  contracts: Record<string, string>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const toHexValue = (value: bigint | number | string) => {
  if (typeof value === 'string') {
    return value.startsWith('0x') ? value : ethers.toBeHex(BigInt(value))
  }

  return ethers.toBeHex(BigInt(value))
}

const main = async () => {
  const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(raw) as LocalDeployments
  const rpcUrl = process.env.LOCAL_RPC_URL ?? deployments.rpcUrl ?? DEFAULT_RPC_URL
  const bundlerUrl = process.env.LOCAL_BUNDLER_URL ?? deployments.bundlerUrl ?? DEFAULT_BUNDLER_URL
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const ownerWallet = ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider)
  const ownerSigner = new ethers.NonceManager(ownerWallet)

  const entryPoint = deployments.contracts.entryPoint
  const safe4337Module = deployments.contracts.safe4337Module
  const safeModulesSetup = deployments.contracts.safe4337SetupHelper
  const safeWebAuthnSharedSigner = deployments.contracts.safeWebAuthnSharedSigner

  if (!entryPoint || entryPoint === ZERO_ADDRESS) {
    throw new Error('EntryPoint address missing in local deployments')
  }
  if (!safe4337Module || safe4337Module === ZERO_ADDRESS) {
    throw new Error('Safe4337Module address missing in local deployments')
  }
  if (!safeModulesSetup || safeModulesSetup === ZERO_ADDRESS) {
    throw new Error('Safe4337 setup helper address missing in local deployments')
  }

  const safeModulesSetupInterface = new ethers.Interface([
    'function enableModules(address[] modules)',
  ])
  const safeAccountConfig = {
    owners: [ownerWallet.address],
    threshold: 1,
    to: safeModulesSetup,
    data: safeModulesSetupInterface.encodeFunctionData('enableModules', [[safe4337Module]]),
    fallbackHandler: safe4337Module,
    paymentToken: ZERO_ADDRESS,
    payment: 0,
    paymentReceiver: ZERO_ADDRESS,
  }
  const safeDeploymentConfig = {
    safeVersion: '1.4.1',
    saltNonce: PREDETERMINED_SALT_NONCE,
  }
  const contractNetworks = {
    ['31337']: {
      safeSingletonAddress: deployments.contracts.safeSingleton,
      safeProxyFactoryAddress: deployments.contracts.safeProxyFactory,
      multiSendAddress: deployments.contracts.multiSend,
      multiSendCallOnlyAddress: deployments.contracts.multiSendCallOnly,
      safeWebAuthnSignerFactoryAddress: deployments.contracts.safeWebAuthnSignerFactory,
      safeWebAuthnSharedSignerAddress:
        safeWebAuthnSharedSigner && safeWebAuthnSharedSigner !== ZERO_ADDRESS
          ? safeWebAuthnSharedSigner
          : undefined,
    },
  }

  const protocolKit = await Safe.init({
    provider: rpcUrl,
    signer: ownerWallet.privateKey,
    predictedSafe: {
      safeAccountConfig,
      safeDeploymentConfig,
    },
    contractNetworks,
  })
  const safeAddress = await protocolKit.getAddress()

  const balance = await provider.getBalance(safeAddress)
  const targetFunding = ethers.parseEther('0.5')
  if (balance < targetFunding) {
    const tx = await ownerSigner.sendTransaction({ to: safeAddress, value: targetFunding })
    await tx.wait()
  }

  const bundlerClient = createBundlerClient(bundlerUrl)
  const supportedEntryPoints = (await bundlerClient.request({
    method: 'eth_supportedEntryPoints',
    params: [],
  })) as string[]
  if (!supportedEntryPoints.map((value) => value.toLowerCase()).includes(entryPoint.toLowerCase())) {
    throw new Error(`Bundler does not support EntryPoint ${entryPoint}`)
  }

  const chainId = await bundlerClient.request({ method: 'eth_chainId', params: [] })
  const safe4337Pack = new Safe4337Pack({
    protocolKit,
    bundlerClient,
    bundlerUrl,
    chainId: BigInt(chainId),
    entryPointAddress: entryPoint,
    safe4337ModuleAddress: safe4337Module,
    safeWebAuthnSharedSignerAddress:
      safeWebAuthnSharedSigner && safeWebAuthnSharedSigner !== ZERO_ADDRESS
        ? safeWebAuthnSharedSigner
        : undefined,
  })

  const transactions = [
    {
      to: ownerWallet.address,
      value: '0',
      data: '0x',
      operation: 0,
    },
  ]
  const userOp = await createUserOperation(protocolKit, transactions, {
    entryPoint,
    paymasterOptions: undefined as never,
  })

  userOp.callGasLimit = 1_500_000n
  userOp.verificationGasLimit = 1_500_000n
  userOp.preVerificationGas = 200_000n
  userOp.maxFeePerGas = 12_000_000_000n
  userOp.maxPriorityFeePerGas = 12_000_000_000n

  const safeOperation = SafeOperationFactory.createSafeOperation(userOp, {
    chainId: BigInt(chainId),
    moduleAddress: safe4337Module,
    entryPoint,
  })
  const signedOperation = await safe4337Pack.signSafeOperation(safeOperation)
  const signedUserOp = signedOperation.getUserOperation()

  const {
    paymaster,
    paymasterData,
    paymasterPostOpGasLimit,
    paymasterVerificationGasLimit,
    ...baseUserOp
  } = signedUserOp
  const hasPaymaster =
    paymaster != null && paymaster !== '0x' && paymaster !== ZERO_ADDRESS

  const normalizedUserOp = {
    ...baseUserOp,
    nonce: toHexValue(signedUserOp.nonce),
    callGasLimit: toHexValue(signedUserOp.callGasLimit),
    verificationGasLimit: toHexValue(signedUserOp.verificationGasLimit),
    preVerificationGas: toHexValue(signedUserOp.preVerificationGas),
    maxFeePerGas: toHexValue(signedUserOp.maxFeePerGas),
    maxPriorityFeePerGas: toHexValue(signedUserOp.maxPriorityFeePerGas),
    ...(hasPaymaster
      ? {
          paymaster,
          paymasterData: paymasterData ?? '0x',
          paymasterPostOpGasLimit: toHexValue(paymasterPostOpGasLimit ?? 0n),
          paymasterVerificationGasLimit: toHexValue(
            paymasterVerificationGasLimit ?? 0n,
          ),
        }
      : {}),
  }

  const userOpHash = (await bundlerClient.request({
    method: 'eth_sendUserOperation',
    params: [normalizedUserOp, entryPoint],
  })) as string

  let receipt: unknown | null = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    receipt = await bundlerClient.request({
      method: 'eth_getUserOperationReceipt',
      params: [userOpHash],
    })
    if (receipt) {
      break
    }
    await sleep(2_000)
  }

  if (!receipt) {
    throw new Error(`Timed out waiting for bundler receipt for ${userOpHash}`)
  }

  const deployed = await protocolKit.isSafeDeployed()
  console.log('Safe4337 bundler smoke test')
  console.log('  Safe address:', safeAddress)
  console.log('  UserOp hash:', userOpHash)
  console.log('  Safe deployed:', deployed)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

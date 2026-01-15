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
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')

type LocalDeployments = {
  rpcUrl: string
  contracts: Record<string, string>
}

const packUint128 = (high: bigint, low: bigint) => (high << 128n) | low

const extractRevertData = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const asAny = error as {
    data?: string
    error?: { data?: string }
    info?: { error?: { data?: string } }
  }

  return asAny.data ?? asAny.error?.data ?? asAny.info?.error?.data
}

const main = async () => {
  const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(raw) as LocalDeployments
  const rpcUrl = deployments.rpcUrl ?? 'http://127.0.0.1:8545'
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const ownerWallet = ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider)

  const entryPoint = deployments.contracts.entryPoint
  const entryPointSimulations = deployments.contracts.entryPointSimulations
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

  userOp.callGasLimit = 5_000_000n
  userOp.verificationGasLimit = 5_000_000n
  userOp.preVerificationGas = 200_000n
  userOp.maxFeePerGas = 10_000_000_000n
  userOp.maxPriorityFeePerGas = 10_000_000_000n

  const chainId = 31337n
  const safeOperation = SafeOperationFactory.createSafeOperation(userOp, {
    chainId,
    moduleAddress: safe4337Module,
    entryPoint,
  })
  const safe4337Pack = new Safe4337Pack({
    protocolKit,
    bundlerClient: createBundlerClient(rpcUrl),
    bundlerUrl: rpcUrl,
    chainId,
    entryPointAddress: entryPoint,
    safe4337ModuleAddress: safe4337Module,
    safeWebAuthnSharedSignerAddress:
      safeWebAuthnSharedSigner && safeWebAuthnSharedSigner !== ZERO_ADDRESS
        ? safeWebAuthnSharedSigner
        : undefined,
  })
  const signedOperation = await safe4337Pack.signSafeOperation(safeOperation)
  const signedUserOp = signedOperation.getUserOperation()

  const initCode =
    'factory' in signedUserOp && signedUserOp.factory
      ? ethers.concat([signedUserOp.factory, signedUserOp.factoryData ?? '0x'])
      : '0x'

  const packedUserOp = {
    sender: signedUserOp.sender,
    nonce: BigInt(signedUserOp.nonce),
    initCode,
    callData: signedUserOp.callData,
    accountGasLimits: ethers.toBeHex(
      packUint128(
        BigInt(signedUserOp.verificationGasLimit),
        BigInt(signedUserOp.callGasLimit),
      ),
      32,
    ),
    preVerificationGas: BigInt(signedUserOp.preVerificationGas),
    gasFees: ethers.toBeHex(
      packUint128(
        BigInt(signedUserOp.maxPriorityFeePerGas),
        BigInt(signedUserOp.maxFeePerGas),
      ),
      32,
    ),
    paymasterAndData: '0x',
    signature: signedUserOp.signature,
  }

  const entryPointSimArtifact = JSON.parse(
    await readFile(
      path.resolve(
        __dirname,
        '../node_modules/@account-abstraction/contracts/artifacts/EntryPointSimulations.json',
      ),
      'utf-8',
    ),
  ) as { abi: unknown }

  if (!entryPointSimulations || entryPointSimulations === ZERO_ADDRESS) {
    throw new Error(
      'EntryPointSimulations not deployed. Run: pnpm -C onchain deploy:entrypoint-sim',
    )
  }

  const entryPointSim = new ethers.Contract(
    entryPointSimulations,
    entryPointSimArtifact.abi,
    provider,
  )
  const iface = new ethers.Interface(entryPointSimArtifact.abi)
  const callData = iface.encodeFunctionData('simulateValidation', [packedUserOp])

  try {
  const result = await provider.call({ to: entryPointSimulations, data: callData })
    console.log('simulateValidation result (raw):', result)
  } catch (error) {
    const revertData = extractRevertData(error)
    const decoded = revertData && typeof revertData === 'string' ? iface.parseError(revertData) : undefined

    console.log('simulateValidation reverted')
    console.log('  raw data:', revertData)
    console.log('  decoded:', decoded?.name ?? 'unknown')
    if (decoded?.args) {
      console.log('  args:', decoded.args)
    }
    if (!revertData) {
      console.log('  error:', error)
    }

    try {
      const trace = await provider.send('debug_traceCall', [
        { to: entryPointSimulations, data: callData },
        'latest',
        {},
      ])
      const returnValue = trace?.returnValue
      console.log('  trace.returnValue:', returnValue)
      if (returnValue && typeof returnValue === 'string' && returnValue !== '0x') {
        try {
          const traceDecoded = iface.parseError(returnValue)
          console.log('  trace.decoded:', traceDecoded.name)
          console.log('  trace.args:', traceDecoded.args)
        } catch (decodeError) {
          console.log('  trace.decodeError:', decodeError)
        }
      }
    } catch (traceError) {
      console.log('  trace error:', traceError)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

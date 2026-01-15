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

const main = async () => {
  const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(raw) as LocalDeployments
  const rpcUrl = deployments.rpcUrl ?? 'http://127.0.0.1:8545'
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

  userOp.callGasLimit = 1_000_000n
  userOp.verificationGasLimit = 1_000_000n
  userOp.preVerificationGas = 100_000n
  userOp.maxFeePerGas = 1_000_000_000n
  userOp.maxPriorityFeePerGas = 1_000_000_000n

  const chainId = await protocolKit.getChainId()
  const bundlerClient = createBundlerClient(rpcUrl)
  const safe4337Pack = new Safe4337Pack({
    protocolKit,
    bundlerClient,
    bundlerUrl: rpcUrl,
    chainId,
    entryPointAddress: entryPoint,
    safe4337ModuleAddress: safe4337Module,
    safeWebAuthnSharedSignerAddress:
      safeWebAuthnSharedSigner && safeWebAuthnSharedSigner !== ZERO_ADDRESS
        ? safeWebAuthnSharedSigner
        : undefined,
  })
  const safeOperation = SafeOperationFactory.createSafeOperation(userOp, {
    chainId,
    moduleAddress: safe4337Module,
    entryPoint,
  })
  const signedSafeOperation = await safe4337Pack.signSafeOperation(safeOperation)
  const signedUserOp = signedSafeOperation.getUserOperation()

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

  const entryPointArtifact = JSON.parse(
    await readFile(
      path.resolve(
        __dirname,
        '../node_modules/@account-abstraction/contracts/artifacts/EntryPoint.json',
      ),
      'utf-8',
    ),
  ) as { abi: unknown }
  const entryPointContract = new ethers.Contract(
    entryPoint,
    entryPointArtifact.abi,
    ownerSigner,
  )

  const tx = await entryPointContract.handleOps([packedUserOp], ownerWallet.address)
  const receipt = await tx.wait()
  const deployed = await protocolKit.isSafeDeployed()

  console.log('Safe4337 userop smoke test')
  console.log('  Safe address:', safeAddress)
  console.log('  Tx hash:', receipt?.hash)
  console.log('  Safe deployed:', deployed)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers as ethersLib } from 'ethers'
import hre from 'hardhat'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545'
const DEFAULT_BUNDLER_URL = 'http://127.0.0.1:14337/rpc'
const HARDHAT_MNEMONIC =
  process.env.LOCAL_MNEMONIC ??
  'test test test test test test test test test test test junk'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')
const require = createRequire(import.meta.url)

const emptyContracts = {
  entryPoint: ZERO_ADDRESS,
  safeSingleton: ZERO_ADDRESS,
  safeProxyFactory: ZERO_ADDRESS,
  multiSend: ZERO_ADDRESS,
  multiSendCallOnly: ZERO_ADDRESS,
  safe4337Module: ZERO_ADDRESS,
  safe4337FallbackHandler: ZERO_ADDRESS,
  safe4337SetupHelper: ZERO_ADDRESS,
  safe7579Adapter: ZERO_ADDRESS,
  safeWebAuthnSignerFactory: ZERO_ADDRESS,
  safeWebAuthnSharedSigner: ZERO_ADDRESS,
  passkeyVerifier: ZERO_ADDRESS,
  circlePaymaster: ZERO_ADDRESS,
  circlePaymasterToken: ZERO_ADDRESS,
  sponsorPaymaster: ZERO_ADDRESS,
}

const ARTIFACT_PATHS = {
  entryPoint: '@account-abstraction/contracts/artifacts/EntryPoint.json',
  safeSingleton: '@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json',
  safeProxyFactory:
    '@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json',
  multiSend:
    '@safe-global/safe-contracts/build/artifacts/contracts/libraries/MultiSend.sol/MultiSend.json',
  multiSendCallOnly:
    '@safe-global/safe-contracts/build/artifacts/contracts/libraries/MultiSendCallOnly.sol/MultiSendCallOnly.json',
  safe4337Module:
    '@safe-global/safe-4337/build/artifacts/contracts/Safe4337Module.sol/Safe4337Module.json',
  safeModuleSetup:
    '@safe-global/safe-4337/build/artifacts/contracts/SafeModuleSetup.sol/SafeModuleSetup.json',
  safeWebAuthnSignerFactory:
    '@safe-global/safe-passkey/build/artifacts/contracts/SafeWebAuthnSignerFactory.sol/SafeWebAuthnSignerFactory.json',
  safeWebAuthnSharedSigner:
    '@safe-global/safe-passkey/build/artifacts/contracts/4337/SafeWebAuthnSharedSigner.sol/SafeWebAuthnSharedSigner.json',
  passkeyVerifier:
    '@safe-global/safe-passkey/build/artifacts/contracts/verifiers/FCLP256Verifier.sol/FCLP256Verifier.json',
} as const

type Artifact = {
  abi: unknown
  bytecode: string
}

const loadArtifact = async (artifactPath: string): Promise<Artifact> => {
  const resolvedPath = require.resolve(artifactPath)
  const raw = await readFile(resolvedPath, 'utf-8')
  const parsed = JSON.parse(raw) as {
    abi?: unknown
    bytecode?: string | { object?: string }
  }
  const bytecode =
    typeof parsed.bytecode === 'string'
      ? parsed.bytecode
      : typeof parsed.bytecode?.object === 'string'
        ? parsed.bytecode.object
        : ''

  if (!bytecode) {
    throw new Error(`Missing bytecode for ${artifactPath}`)
  }

  return {
    abi: parsed.abi ?? [],
    bytecode,
  }
}

const loadLocalArtifact = async (relativePath: string): Promise<Artifact> => {
  const resolvedPath = path.resolve(__dirname, relativePath)
  const raw = await readFile(resolvedPath, 'utf-8')
  const parsed = JSON.parse(raw) as { abi?: unknown; bytecode?: string | { object?: string } }
  const bytecode =
    typeof parsed.bytecode === 'string'
      ? parsed.bytecode
      : typeof parsed.bytecode?.object === 'string'
        ? parsed.bytecode.object
        : ''

  if (!bytecode) {
    throw new Error(`Missing bytecode for ${relativePath}`)
  }

  return {
    abi: parsed.abi ?? [],
    bytecode,
  }
}

const buildDeployBytecode = async (
  artifact: Artifact,
  signer: ethersLib.Signer,
  args: unknown[] = [],
) => {
  if (args.length === 0) {
    return artifact.bytecode
  }

  const factory = new ethersLib.ContractFactory(artifact.abi, artifact.bytecode, signer)
  const tx = await factory.getDeployTransaction(...args)

  if (!tx.data) {
    throw new Error('Missing deploy data')
  }

  return tx.data
}

const deployWithCreate2 = async (
  deployer: any,
  bytecode: string,
  salt: string,
  provider: ethersLib.JsonRpcProvider,
) => {
  const saltHash = ethersLib.id(salt)
  const bytecodeHash = ethersLib.keccak256(bytecode)
  const predicted = await deployer.predictAddress(saltHash, bytecodeHash)
  const code = (await provider.getCode(predicted)) as string

  if (code !== '0x') {
    return predicted
  }

  const tx = await deployer.deploy(saltHash, bytecode)
  await tx.wait()
  return predicted
}

const main = async () => {
  const networkName = hre.network?.name ?? 'localhost'
  const rpcUrl =
    process.env.LOCAL_RPC_URL ??
    (networkName === 'localhost' ? DEFAULT_RPC_URL : DEFAULT_RPC_URL)
  const provider = new ethersLib.JsonRpcProvider(rpcUrl)
  const baseSigner = ethersLib.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider)
  const signer = new ethersLib.NonceManager(baseSigner)
  const networkInfo = await provider.getNetwork()
  const chainId = Number(networkInfo.chainId)
  const bundlerUrl = process.env.LOCAL_BUNDLER_URL ?? DEFAULT_BUNDLER_URL

  const deployerArtifact = await loadLocalArtifact(
    '../artifacts/contracts/DeterministicDeployer.sol/DeterministicDeployer.json',
  )
  const deployerFactory = new ethersLib.ContractFactory(
    deployerArtifact.abi,
    deployerArtifact.bytecode,
    signer,
  )
  const deterministicDeployer = await deployerFactory.deploy()
  await deterministicDeployer.waitForDeployment()

  const [
    entryPointArtifact,
    safeArtifact,
    safeProxyFactoryArtifact,
    multiSendArtifact,
    multiSendCallOnlyArtifact,
    safe4337Artifact,
    safeModuleSetupArtifact,
    safe7579AdapterArtifact,
    safeWebAuthnSignerFactoryArtifact,
    safeWebAuthnSharedSignerArtifact,
    passkeyVerifierArtifact,
    mockUsdcArtifact,
    circlePaymasterArtifact,
    sponsorPaymasterArtifact,
  ] = await Promise.all([
    loadArtifact(ARTIFACT_PATHS.entryPoint),
    loadArtifact(ARTIFACT_PATHS.safeSingleton),
    loadArtifact(ARTIFACT_PATHS.safeProxyFactory),
    loadArtifact(ARTIFACT_PATHS.multiSend),
    loadArtifact(ARTIFACT_PATHS.multiSendCallOnly),
    loadArtifact(ARTIFACT_PATHS.safe4337Module),
    loadArtifact(ARTIFACT_PATHS.safeModuleSetup),
    loadLocalArtifact('../artifacts/contracts/Safe7579AdapterStub.sol/Safe7579AdapterStub.json'),
    loadArtifact(ARTIFACT_PATHS.safeWebAuthnSignerFactory),
    loadArtifact(ARTIFACT_PATHS.safeWebAuthnSharedSigner),
    loadArtifact(ARTIFACT_PATHS.passkeyVerifier),
    loadLocalArtifact('../artifacts/contracts/MockUSDC.sol/MockUSDC.json'),
    loadLocalArtifact('../artifacts/contracts/CirclePaymasterStub.sol/CirclePaymasterStub.json'),
    loadLocalArtifact('../artifacts/contracts/SponsorPaymasterStub.sol/SponsorPaymasterStub.json'),
  ])

  const entryPointAddress = await deployWithCreate2(
    deterministicDeployer,
    entryPointArtifact.bytecode,
    'aa-demo:entrypoint',
    provider,
  )
  const safe4337ModuleBytecode = await buildDeployBytecode(
    safe4337Artifact,
    signer,
    [entryPointAddress],
  )
  const safeSingletonAddress = await deployWithCreate2(
    deterministicDeployer,
    safeArtifact.bytecode,
    'aa-demo:safe-singleton',
    provider,
  )
  const safeProxyFactoryAddress = await deployWithCreate2(
    deterministicDeployer,
    safeProxyFactoryArtifact.bytecode,
    'aa-demo:safe-proxy-factory',
    provider,
  )
  const multiSendAddress = await deployWithCreate2(
    deterministicDeployer,
    multiSendArtifact.bytecode,
    'aa-demo:safe-multisend',
    provider,
  )
  const multiSendCallOnlyAddress = await deployWithCreate2(
    deterministicDeployer,
    multiSendCallOnlyArtifact.bytecode,
    'aa-demo:safe-multisend-callonly',
    provider,
  )
  const safe4337ModuleAddress = await deployWithCreate2(
    deterministicDeployer,
    safe4337ModuleBytecode,
    'aa-demo:safe-4337-module',
    provider,
  )
  const safeModuleSetupAddress = await deployWithCreate2(
    deterministicDeployer,
    safeModuleSetupArtifact.bytecode,
    'aa-demo:safe-4337-setup-helper',
    provider,
  )
  const safe7579AdapterAddress = await deployWithCreate2(
    deterministicDeployer,
    safe7579AdapterArtifact.bytecode,
    'aa-demo:safe-7579-adapter',
    provider,
  )
  const safeWebAuthnSignerFactoryAddress = await deployWithCreate2(
    deterministicDeployer,
    safeWebAuthnSignerFactoryArtifact.bytecode,
    'aa-demo:passkey-signer-factory',
    provider,
  )
  const safeWebAuthnSharedSignerAddress = await deployWithCreate2(
    deterministicDeployer,
    safeWebAuthnSharedSignerArtifact.bytecode,
    'aa-demo:passkey-shared-signer',
    provider,
  )
  const passkeyVerifierAddress = await deployWithCreate2(
    deterministicDeployer,
    passkeyVerifierArtifact.bytecode,
    'aa-demo:passkey-fcl-verifier',
    provider,
  )
  const usdcSupply = 1_000_000n * 10n ** 6n
  const usdcHolder = await baseSigner.getAddress()
  const mockUsdcBytecode = await buildDeployBytecode(mockUsdcArtifact, signer, [
    usdcSupply,
    usdcHolder,
  ])
  const mockUsdcAddress = await deployWithCreate2(
    deterministicDeployer,
    mockUsdcBytecode,
    'aa-demo:mock-usdc',
    provider,
  )
  const circlePaymasterAddress = await deployWithCreate2(
    deterministicDeployer,
    circlePaymasterArtifact.bytecode,
    'aa-demo:circle-paymaster',
    provider,
  )
  const sponsorPaymasterAddress = await deployWithCreate2(
    deterministicDeployer,
    sponsorPaymasterArtifact.bytecode,
    'aa-demo:sponsor-paymaster',
    provider,
  )

  const deployments = {
    chainId,
    rpcUrl,
    bundlerUrl,
    deterministicDeployer: await deterministicDeployer.getAddress(),
    contracts: {
      ...emptyContracts,
      entryPoint: entryPointAddress,
      safeSingleton: safeSingletonAddress,
      safeProxyFactory: safeProxyFactoryAddress,
      multiSend: multiSendAddress,
      multiSendCallOnly: multiSendCallOnlyAddress,
      safe4337Module: safe4337ModuleAddress,
      safe4337FallbackHandler: safe4337ModuleAddress,
      safe4337SetupHelper: safeModuleSetupAddress,
      safe7579Adapter: safe7579AdapterAddress,
      safeWebAuthnSignerFactory: safeWebAuthnSignerFactoryAddress,
      safeWebAuthnSharedSigner: safeWebAuthnSharedSignerAddress,
      passkeyVerifier: passkeyVerifierAddress,
      circlePaymaster: circlePaymasterAddress,
      circlePaymasterToken: mockUsdcAddress,
      sponsorPaymaster: sponsorPaymasterAddress,
    },
  }

  await mkdir(path.dirname(DEPLOYMENTS_PATH), { recursive: true })
  await writeFile(DEPLOYMENTS_PATH, JSON.stringify(deployments, null, 2))
  console.log(`Wrote ${DEPLOYMENTS_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

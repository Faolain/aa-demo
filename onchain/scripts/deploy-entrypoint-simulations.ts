import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { ethers } from 'ethers'

const HARDHAT_MNEMONIC =
  process.env.LOCAL_MNEMONIC ??
  'test test test test test test test test test test test junk'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')
const require = createRequire(import.meta.url)

type LocalDeployments = {
  rpcUrl?: string
  contracts: Record<string, string>
}

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

const main = async () => {
  const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(raw) as LocalDeployments
  const rpcUrl = deployments.rpcUrl ?? 'http://127.0.0.1:8545'
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const signer = ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).connect(provider)

  const blockNumber = await provider.getBlockNumber()
  if (blockNumber >= 1000) {
    throw new Error(
      `EntryPointSimulations constructor requires block < 1000 (current ${blockNumber}). Restart Hardhat node and retry.`,
    )
  }

  const artifact = await loadArtifact(
    '@account-abstraction/contracts/artifacts/EntryPointSimulations.json',
  )
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer)
  const contract = await factory.deploy()
  await contract.waitForDeployment()

  const address = await contract.getAddress()
  const updated = {
    ...deployments,
    contracts: {
      ...deployments.contracts,
      entryPointSimulations: address,
    },
  }

  await writeFile(DEPLOYMENTS_PATH, JSON.stringify(updated, null, 2))
  console.log(`Deployed EntryPointSimulations at ${address}`)
  console.log(`Updated ${DEPLOYMENTS_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

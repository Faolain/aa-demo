import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DEFAULT_RPC_URL = 'http://127.0.0.1:8545'
const DEFAULT_BUNDLER_URL = 'http://127.0.0.1:14337/rpc'
const HARDHAT_MNEMONIC =
  process.env.LOCAL_MNEMONIC ??
  'test test test test test test test test test test test junk'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')
const OUTPUT_PATH = path.resolve(__dirname, '../bundler/skandha.local.json')

type LocalDeployments = {
  rpcUrl?: string
  bundlerUrl?: string
  contracts: Record<string, string>
}

const main = async () => {
  const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
  const deployments = JSON.parse(raw) as LocalDeployments
  const entryPoint = deployments.contracts.entryPoint

  if (!entryPoint || entryPoint === ZERO_ADDRESS) {
    throw new Error('EntryPoint address missing in local deployments')
  }

  const rpcEndpoint = process.env.LOCAL_RPC_URL ?? deployments.rpcUrl ?? DEFAULT_RPC_URL
  const bundlerUrl = process.env.LOCAL_BUNDLER_URL ?? deployments.bundlerUrl ?? DEFAULT_BUNDLER_URL
  const relayerKey =
    process.env.SKANDHA_RELAYER_KEY ?? ethers.Wallet.fromPhrase(HARDHAT_MNEMONIC).privateKey

  const config = {
    entryPoints: [entryPoint],
    relayers: [relayerKey],
    rpcEndpoint,
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, JSON.stringify(config, null, 2))
  console.log(`Wrote ${OUTPUT_PATH}`)
  console.log(`Bundler URL: ${bundlerUrl}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

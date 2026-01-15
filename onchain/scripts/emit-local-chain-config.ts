import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEPLOYMENTS_PATH = path.resolve(__dirname, '../deployments/local.json')
const FRONTEND_OUTPUT_PATH = path.resolve(__dirname, '../../src/wallet/chain/local.generated.ts')

type LocalDeployments = {
  chainId: number
  rpcUrl: string
  bundlerUrl: string
  deterministicDeployer?: string
  contracts: Partial<Record<ContractKey, string>>
}

type ContractKey =
  | 'entryPoint'
  | 'safeSingleton'
  | 'safeProxyFactory'
  | 'multiSend'
  | 'multiSendCallOnly'
  | 'safe4337Module'
  | 'safe4337FallbackHandler'
  | 'safe4337SetupHelper'
  | 'safe7579Adapter'
  | 'safeWebAuthnSignerFactory'
  | 'safeWebAuthnSharedSigner'
  | 'passkeyVerifier'
  | 'circlePaymaster'
  | 'circlePaymasterToken'
  | 'sponsorPaymaster'

const defaultDeployments: LocalDeployments = {
  chainId: 31337,
  rpcUrl: 'http://127.0.0.1:8545',
  bundlerUrl: 'http://127.0.0.1:14337/rpc',
  contracts: {},
}

const contractKeys: ContractKey[] = [
  'entryPoint',
  'safeSingleton',
  'safeProxyFactory',
  'multiSend',
  'multiSendCallOnly',
  'safe4337Module',
  'safe4337FallbackHandler',
  'safe4337SetupHelper',
  'safe7579Adapter',
  'safeWebAuthnSignerFactory',
  'safeWebAuthnSharedSigner',
  'passkeyVerifier',
  'circlePaymaster',
  'circlePaymasterToken',
  'sponsorPaymaster',
]

const loadDeployments = async (): Promise<LocalDeployments> => {
  if (!existsSync(DEPLOYMENTS_PATH)) {
    return defaultDeployments
  }

  try {
    const raw = await readFile(DEPLOYMENTS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as LocalDeployments
    return {
      ...defaultDeployments,
      ...parsed,
      contracts: {
        ...defaultDeployments.contracts,
        ...parsed.contracts,
      },
    }
  } catch (error) {
    console.warn('Failed to read deployments file, using defaults', error)
    return defaultDeployments
  }
}

const renderLocalChainConfig = (deployments: LocalDeployments) => {
  const contractLines = contractKeys.map((key) => {
    const value = deployments.contracts[key] ?? ZERO_ADDRESS
    return `  ${key}: '${value}',`
  })

  return [
    "import type { ChainConfig } from '../types'",
    '',
    'export const localChainConfig = {',
    `  chainId: ${deployments.chainId},`,
    "  name: 'Local Hardhat',",
    `  rpcUrls: ['${deployments.rpcUrl}'],`,
    `  bundlerUrls: ['${deployments.bundlerUrl}'],`,
    ...contractLines,
    '} satisfies ChainConfig',
    '',
  ].join('\n')
}

const main = async () => {
  const deployments = await loadDeployments()
  const contents = renderLocalChainConfig(deployments)

  await mkdir(path.dirname(FRONTEND_OUTPUT_PATH), { recursive: true })
  await writeFile(FRONTEND_OUTPUT_PATH, contents)
  console.log(`Wrote ${FRONTEND_OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

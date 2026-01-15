import { ENTRYPOINT_V08_ADDRESS, ZERO_ADDRESS } from '../constants'
import type { ChainConfig, HexAddress } from '../types'
import { getDefaultBundlerUrls } from './bundlers'
import { resolveSafeDeployments } from './deployments'
import { localChainConfig } from './local.generated'
import { SOCIAL_RECOVERY_BYTECODE_HASH, SOCIAL_RECOVERY_MODULE } from '../recovery'

const ADDRESS_PLACEHOLDER = '0x0000000000000000000000000000000000000000' as const satisfies HexAddress
const CIRCLE_PAYMASTER_MAINNET = '0x0578c3fE1Ac5480C63D57C67A3f409B2F0CD800d' as const satisfies HexAddress
const CIRCLE_PAYMASTER_TESTNET = '0x3BA9f1396f5B5009f0cE1BdEbF051d79dC073F6D' as const satisfies HexAddress
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const satisfies HexAddress
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const satisfies HexAddress
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const satisfies HexAddress
const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const satisfies HexAddress
const SAFE_7579_ADAPTER_ADDRESS =
  '0x7579f2AD53b01c3D8779Fe17928e0D48885B0003' as const satisfies HexAddress
const pimlicoPaymaster = (chainId: number) => `https://public.pimlico.io/v2/${chainId}/rpc`
const SOCIAL_RECOVERY_ALLOWLIST_ENTRY = {
  ...SOCIAL_RECOVERY_MODULE,
  bytecodeHash: SOCIAL_RECOVERY_BYTECODE_HASH,
} as const

const isZeroAddress = (value?: HexAddress) => !value || value === ZERO_ADDRESS

const mergeWithSafeDeployments = (config: ChainConfig): ChainConfig => {
  const resolved = resolveSafeDeployments(config.chainId)

  return {
    ...config,
    safeSingleton: isZeroAddress(config.safeSingleton)
      ? resolved.safeSingleton ?? config.safeSingleton
      : config.safeSingleton,
    safeProxyFactory: isZeroAddress(config.safeProxyFactory)
      ? resolved.safeProxyFactory ?? config.safeProxyFactory
      : config.safeProxyFactory,
    safe4337Module: isZeroAddress(config.safe4337Module)
      ? resolved.safe4337Module ?? config.safe4337Module
      : config.safe4337Module,
    safe4337FallbackHandler: isZeroAddress(config.safe4337FallbackHandler)
      ? resolved.safe4337FallbackHandler ?? config.safe4337FallbackHandler
      : config.safe4337FallbackHandler,
    safe4337SetupHelper: isZeroAddress(config.safe4337SetupHelper)
      ? resolved.safe4337SetupHelper ?? config.safe4337SetupHelper
      : config.safe4337SetupHelper,
  }
}

export const CHAIN_IDS = {
  ethereum: 1,
  base: 8453,
  sepolia: 11155111,
  baseSepolia: 84532,
  local: localChainConfig.chainId,
} as const

export type WalletChainKey = keyof typeof CHAIN_IDS

export const CHAIN_CONFIGS: Record<WalletChainKey, ChainConfig> = {
  ethereum: mergeWithSafeDeployments({
    chainId: CHAIN_IDS.ethereum,
    name: 'Ethereum Mainnet',
    rpcUrls: [],
    bundlerUrls: getDefaultBundlerUrls(CHAIN_IDS.ethereum),
    entryPoint: ENTRYPOINT_V08_ADDRESS,
    safeSingleton: ADDRESS_PLACEHOLDER,
    safeProxyFactory: ADDRESS_PLACEHOLDER,
    safe4337Module: ADDRESS_PLACEHOLDER,
    safe4337FallbackHandler: ADDRESS_PLACEHOLDER,
    safe4337SetupHelper: ADDRESS_PLACEHOLDER,
    safe7579Adapter: SAFE_7579_ADAPTER_ADDRESS,
    circlePaymaster: CIRCLE_PAYMASTER_MAINNET,
    circlePaymasterToken: USDC_ETHEREUM,
    circlePaymasterUrl: pimlicoPaymaster(CHAIN_IDS.ethereum),
    sponsorPaymaster: ADDRESS_PLACEHOLDER,
    moduleAllowlist: [],
  }),
  base: mergeWithSafeDeployments({
    chainId: CHAIN_IDS.base,
    name: 'Base Mainnet',
    rpcUrls: ['https://mainnet.base.org'],
    bundlerUrls: getDefaultBundlerUrls(CHAIN_IDS.base),
    entryPoint: ENTRYPOINT_V08_ADDRESS,
    safeSingleton: ADDRESS_PLACEHOLDER,
    safeProxyFactory: ADDRESS_PLACEHOLDER,
    safe4337Module: ADDRESS_PLACEHOLDER,
    safe4337FallbackHandler: ADDRESS_PLACEHOLDER,
    safe4337SetupHelper: ADDRESS_PLACEHOLDER,
    safe7579Adapter: SAFE_7579_ADAPTER_ADDRESS,
    circlePaymaster: CIRCLE_PAYMASTER_MAINNET,
    circlePaymasterToken: USDC_BASE,
    circlePaymasterUrl: pimlicoPaymaster(CHAIN_IDS.base),
    sponsorPaymaster: ADDRESS_PLACEHOLDER,
    moduleAllowlist: [SOCIAL_RECOVERY_ALLOWLIST_ENTRY],
  }),
  sepolia: mergeWithSafeDeployments({
    chainId: CHAIN_IDS.sepolia,
    name: 'Sepolia',
    rpcUrls: [],
    bundlerUrls: getDefaultBundlerUrls(CHAIN_IDS.sepolia),
    entryPoint: ENTRYPOINT_V08_ADDRESS,
    safeSingleton: ADDRESS_PLACEHOLDER,
    safeProxyFactory: ADDRESS_PLACEHOLDER,
    safe4337Module: ADDRESS_PLACEHOLDER,
    safe4337FallbackHandler: ADDRESS_PLACEHOLDER,
    safe4337SetupHelper: ADDRESS_PLACEHOLDER,
    safe7579Adapter: SAFE_7579_ADAPTER_ADDRESS,
    circlePaymaster: CIRCLE_PAYMASTER_TESTNET,
    circlePaymasterToken: USDC_SEPOLIA,
    circlePaymasterUrl: pimlicoPaymaster(CHAIN_IDS.sepolia),
    sponsorPaymaster: ADDRESS_PLACEHOLDER,
    moduleAllowlist: [SOCIAL_RECOVERY_ALLOWLIST_ENTRY],
  }),
  baseSepolia: mergeWithSafeDeployments({
    chainId: CHAIN_IDS.baseSepolia,
    name: 'Base Sepolia',
    rpcUrls: [],
    bundlerUrls: getDefaultBundlerUrls(CHAIN_IDS.baseSepolia),
    entryPoint: ENTRYPOINT_V08_ADDRESS,
    safeSingleton: ADDRESS_PLACEHOLDER,
    safeProxyFactory: ADDRESS_PLACEHOLDER,
    safe4337Module: ADDRESS_PLACEHOLDER,
    safe4337FallbackHandler: ADDRESS_PLACEHOLDER,
    safe4337SetupHelper: ADDRESS_PLACEHOLDER,
    safe7579Adapter: SAFE_7579_ADAPTER_ADDRESS,
    circlePaymaster: CIRCLE_PAYMASTER_TESTNET,
    circlePaymasterToken: USDC_BASE_SEPOLIA,
    circlePaymasterUrl: pimlicoPaymaster(CHAIN_IDS.baseSepolia),
    sponsorPaymaster: ADDRESS_PLACEHOLDER,
    moduleAllowlist: [SOCIAL_RECOVERY_ALLOWLIST_ENTRY],
  }),
  local: {
    ...localChainConfig,
    circlePaymasterToken: isZeroAddress(localChainConfig.circlePaymasterToken)
      ? ADDRESS_PLACEHOLDER
      : localChainConfig.circlePaymasterToken,
    moduleAllowlist: [],
  },
}

export const DEFAULT_CHAIN_KEYS: WalletChainKey[] = [
  'base',
  'ethereum',
  'baseSepolia',
  'sepolia',
  'local',
]

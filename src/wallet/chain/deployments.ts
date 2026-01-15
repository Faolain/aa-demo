import {
  getProxyFactoryDeployment,
  getSafeL2SingletonDeployment,
  getSafeSingletonDeployment,
} from '@safe-global/safe-deployments'
import {
  getSafe4337ModuleDeployment,
  getSafeModuleSetupDeployment,
} from '@safe-global/safe-modules-deployments'

import { SAFE_4337_MODULE_VERSION, SAFE_VERSION } from '../constants'
import type { ChainConfig, ChainId, HexAddress } from '../types'

const L2_CHAIN_IDS = new Set<ChainId>([8453, 84532])

type AddressLike = string | string[] | undefined

const pickAddress = (value?: AddressLike): HexAddress | undefined => {
  if (!value) {
    return undefined
  }

  return (Array.isArray(value) ? value[0] : value) as HexAddress
}

const addIfDefined = <K extends keyof ChainConfig>(
  target: Partial<ChainConfig>,
  key: K,
  value: ChainConfig[K] | undefined,
) => {
  if (value) {
    target[key] = value
  }
}

export const resolveSafeDeployments = (chainId: ChainId): Partial<ChainConfig> => {
  const network = String(chainId)
  const safeDeployment = L2_CHAIN_IDS.has(chainId)
    ? getSafeL2SingletonDeployment({ version: SAFE_VERSION, network })
    : getSafeSingletonDeployment({ version: SAFE_VERSION, network })
  const proxyFactoryDeployment = getProxyFactoryDeployment({ version: SAFE_VERSION, network })
  const safe4337Deployment = getSafe4337ModuleDeployment({
    version: SAFE_4337_MODULE_VERSION,
    network,
  })
  const safeModuleSetupDeployment = getSafeModuleSetupDeployment({
    version: SAFE_4337_MODULE_VERSION,
    network,
  })

  const result: Partial<ChainConfig> = {}
  const safeSingleton = pickAddress(safeDeployment?.networkAddresses[network])
  const safeProxyFactory = pickAddress(proxyFactoryDeployment?.networkAddresses[network])
  const safe4337Module = pickAddress(safe4337Deployment?.networkAddresses[network])
  const safe4337SetupHelper = pickAddress(safeModuleSetupDeployment?.networkAddresses[network])

  addIfDefined(result, 'safeSingleton', safeSingleton)
  addIfDefined(result, 'safeProxyFactory', safeProxyFactory)
  addIfDefined(result, 'safe4337Module', safe4337Module)
  addIfDefined(result, 'safe4337FallbackHandler', safe4337Module)
  addIfDefined(result, 'safe4337SetupHelper', safe4337SetupHelper)

  return result
}

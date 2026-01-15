import type { ContractNetworksConfig } from '@safe-global/protocol-kit'

import type { ChainConfig, HexAddress } from '../types'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

const normalizeAddress = (address?: HexAddress) =>
  address && address !== ZERO_ADDRESS ? address : undefined

export const buildContractNetworks = (chain: ChainConfig): ContractNetworksConfig | undefined => {
  const networkConfig: ContractNetworksConfig[string] = {}

  const safeSingletonAddress = normalizeAddress(chain.safeSingleton)
  if (safeSingletonAddress) {
    networkConfig.safeSingletonAddress = safeSingletonAddress
  }

  const safeProxyFactoryAddress = normalizeAddress(chain.safeProxyFactory)
  if (safeProxyFactoryAddress) {
    networkConfig.safeProxyFactoryAddress = safeProxyFactoryAddress
  }

  const multiSendAddress = normalizeAddress(chain.multiSend)
  if (multiSendAddress) {
    networkConfig.multiSendAddress = multiSendAddress
  }

  const multiSendCallOnlyAddress = normalizeAddress(chain.multiSendCallOnly)
  if (multiSendCallOnlyAddress) {
    networkConfig.multiSendCallOnlyAddress = multiSendCallOnlyAddress
  }

  const safeWebAuthnSignerFactoryAddress = normalizeAddress(chain.safeWebAuthnSignerFactory)
  if (safeWebAuthnSignerFactoryAddress) {
    networkConfig.safeWebAuthnSignerFactoryAddress = safeWebAuthnSignerFactoryAddress
  }

  const safeWebAuthnSharedSignerAddress = normalizeAddress(chain.safeWebAuthnSharedSigner)
  if (safeWebAuthnSharedSignerAddress) {
    networkConfig.safeWebAuthnSharedSignerAddress = safeWebAuthnSharedSignerAddress
  }

  if (Object.keys(networkConfig).length === 0) {
    return undefined
  }

  return {
    [chain.chainId.toString()]: networkConfig,
  }
}

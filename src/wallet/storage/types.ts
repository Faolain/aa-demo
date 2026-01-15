import type { ChainId, HexAddress, PasskeyMetadata, RecoveryConfig } from '../types'

export const WALLET_STORAGE_VERSION = 1

export type WalletOwnerConfig = {
  owners: HexAddress[]
  threshold: number
}

export type WalletChainState = {
  predictedAddress?: HexAddress
  deployed?: boolean
  lastCheckedAt?: string
  configHash?: string
}

export type WalletDeploymentConfig = {
  saltNonce?: string
}

export type WalletOverrides = {
  rpcUrls?: string[]
  bundlerUrls?: string[]
  useLocalDevSigner?: boolean
}

export type WalletStatePayload = {
  passkeys: PasskeyMetadata[]
  ownerConfig?: WalletOwnerConfig
  recovery?: RecoveryConfig
  chainState: Record<string, WalletChainState>
  overrides: Record<string, WalletOverrides>
  deploymentConfigByChain: Record<string, WalletDeploymentConfig>
}

export type WalletState = WalletStatePayload & {
  version: number
  updatedAt: string
}

export type WalletStorageOptions = {
  crypto?: StorageCrypto
}

export type WalletOwnerConfigUpdate = {
  ownerConfig: WalletOwnerConfig
  allowAddressChange?: boolean
}

export type WalletOverridesUpdate = {
  chainId: ChainId
  overrides: WalletOverrides
}

export type WalletDeploymentConfigUpdate = {
  chainId: ChainId
  deployment: WalletDeploymentConfig
}

export type WalletChainStateUpdate = {
  chainId: ChainId
  state: Partial<WalletChainState>
}

export type StorageCrypto = {
  encrypt: (plaintext: string) => Promise<EncryptedPayload>
  decrypt: (payload: EncryptedPayload) => Promise<string>
}

export type EncryptedPayload = {
  version: 1
  iv: string
  salt: string
  ciphertext: string
}

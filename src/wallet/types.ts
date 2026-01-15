export type HexAddress = `0x${string}`
export type HexData = `0x${string}`
export type ChainId = number

export type Call = {
  to: HexAddress
  value?: bigint
  data?: HexData
}

export type PasskeyPublicKey = {
  x: string
  y: string
}

export type PasskeyMetadata = {
  rawId: string
  publicKey: PasskeyPublicKey
  rpId?: string
}

export type BundlerEndpoint = {
  url: string
  entryPoints: HexAddress[]
}

export type PaymasterMode = 'sponsored' | 'usdc' | 'native' | 'auto'

export type Safe4337PaymasterOptions = {
  isSponsored?: boolean
  paymasterUrl?: string
  paymasterAddress?: HexAddress
  paymasterTokenAddress?: HexAddress
  sponsorshipPolicyId?: string
  paymasterContext?: Record<string, unknown>
  amountToApprove?: bigint
}

export type PaymasterStatus = {
  requestedMode: PaymasterMode
  resolvedMode: PaymasterMode
  label: string
  description: string
  fallbackReason?: string
  paymasterUrl?: string
}

export type ModuleType = 'validator' | 'executor' | 'hook' | 'fallback'

export type ModuleAllowlistEntry = {
  address: HexAddress
  moduleType: ModuleType
  name?: string
  bytecodeHash?: HexData
}

export type TxResult = {
  chainId: ChainId
  txHash?: HexData
  userOpHash?: HexData
}

export type UserOpResult = {
  chainId: ChainId
  userOpHash: HexData
  paymasterStatus?: PaymasterStatus
}

export type ReceiptPollingOptions = {
  timeoutMs?: number
  pollIntervalMs?: number
}

export type RecoveryConfig = {
  guardians: HexAddress[]
  threshold: number
  moduleAddress?: HexAddress
  allowUnsafeModule?: boolean
}

export type RecoveryExecution = {
  newOwners: HexAddress[]
  newThreshold: number
  guardianSignatures?: HexData[]
  guardianThreshold?: number
  moduleAddress?: HexAddress
  allowUnsafeModule?: boolean
}

export type ChainConfig = {
  chainId: ChainId
  name: string
  rpcUrls: string[]
  bundlerUrls?: string[]
  entryPoint: HexAddress
  safeSingleton: HexAddress
  safeProxyFactory: HexAddress
  multiSend?: HexAddress
  multiSendCallOnly?: HexAddress
  safe4337Module?: HexAddress
  safe4337FallbackHandler?: HexAddress
  safe4337SetupHelper?: HexAddress
  safe7579Adapter?: HexAddress
  safeWebAuthnSignerFactory?: HexAddress
  safeWebAuthnSharedSigner?: HexAddress
  passkeyVerifier?: HexAddress
  circlePaymaster?: HexAddress
  circlePaymasterUrl?: string
  circlePaymasterToken?: HexAddress
  sponsorPaymaster?: HexAddress
  sponsorPaymasterUrl?: string
  moduleAllowlist?: ModuleAllowlistEntry[]
}

import type { UserOperationReceipt } from '@safe-global/relay-kit'
import type {
  BundlerEndpoint,
  Call,
  HexData,
  HexAddress,
  PasskeyMetadata,
  PaymasterMode,
  PaymasterStatus,
  ReceiptPollingOptions,
  RecoveryConfig,
  RecoveryExecution,
  TxResult,
  UserOpResult,
} from '../types'

export type SendCallsOptions = {
  deploymentCalls?: Call[]
}

export interface WalletController {
  createPasskeySigner(): Promise<PasskeyMetadata>
  addPasskeyOwner(passkey: PasskeyMetadata): Promise<TxResult>
  addPortableOwner(ownerAddress: HexAddress): Promise<TxResult>

  getCounterfactualAddress(): Promise<HexAddress>
  isDeployed(): Promise<boolean>

  sendCalls(calls: Call[], options?: SendCallsOptions): Promise<UserOpResult>
  getUserOperationReceipt(userOpHash: HexData): Promise<UserOperationReceipt | null>
  waitForUserOperationReceipt(
    userOpHash: HexData,
    options?: ReceiptPollingOptions,
  ): Promise<UserOperationReceipt>
  setPaymasterMode(mode: PaymasterMode): void
  getPaymasterStatus(): PaymasterStatus | undefined
  setBundlerEndpoints(endpoints: BundlerEndpoint[]): void
  setRpcUrls(urls: string[]): void

  setupRecovery(config: RecoveryConfig): Promise<TxResult>
  recover(config: RecoveryExecution): Promise<UserOpResult>
}

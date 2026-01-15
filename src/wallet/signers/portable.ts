import EthereumProvider from '@walletconnect/ethereum-provider'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import type { HexAddress, HexData } from '../types'

export type Eip1193Provider = {
  request: (args: { method: string; params?: readonly unknown[] | object }) => Promise<unknown>
}

export type InjectedProvider = Eip1193Provider & {
  providers?: InjectedProvider[]
  isRabby?: boolean
  isMetaMask?: boolean
  isCoinbaseWallet?: boolean
  isBraveWallet?: boolean
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

const normalizeAddress = (address: string) => getAddress(address) as HexAddress

const pickInjectedProvider = (providers: InjectedProvider[]) =>
  providers.find((provider) => provider.isRabby) ??
  providers.find((provider) => provider.isMetaMask) ??
  providers.find((provider) => provider.isCoinbaseWallet) ??
  providers.find((provider) => provider.isBraveWallet) ??
  providers[0]

export const getInjectedProvider = (): InjectedProvider | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const { ethereum } = window
  if (!ethereum) {
    return null
  }

  if (Array.isArray(ethereum.providers) && ethereum.providers.length > 0) {
    return pickInjectedProvider(ethereum.providers) ?? null
  }

  return ethereum
}

export type PortableSignerConnection = {
  type: 'injected' | 'walletconnect'
  provider: Eip1193Provider
  address: HexAddress
}

export type LocalSigner = {
  type: 'local'
  address: HexAddress
  privateKey: HexData
}

export type PortableSigner = PortableSignerConnection | LocalSigner

export const connectInjectedSigner = async (
  provider: InjectedProvider | null = getInjectedProvider(),
): Promise<PortableSignerConnection> => {
  if (!provider) {
    throw new Error('No injected wallet detected')
  }

  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from injected wallet')
  }

  return {
    type: 'injected',
    provider,
    address: normalizeAddress(accounts[0]),
  }
}

export type WalletConnectOptions = {
  projectId: string
  chains: [number, ...number[]]
  optionalChains?: number[]
  rpcMap?: Record<number, string>
  metadata?: {
    name: string
    description: string
    url: string
    icons: string[]
  }
  showQrModal?: boolean
}

const normalizeRpcMap = (rpcMap?: Record<number, string>) => {
  if (!rpcMap) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(rpcMap).map(([chainId, url]) => [chainId.toString(), url]),
  )
}

export const createWalletConnectProvider = async (
  options: WalletConnectOptions,
): Promise<EthereumProvider> =>
  EthereumProvider.init({
    projectId: options.projectId,
    chains: options.chains,
    ...(options.optionalChains && options.optionalChains.length > 0
      ? { optionalChains: options.optionalChains }
      : {}),
    rpcMap: normalizeRpcMap(options.rpcMap),
    metadata: options.metadata,
    showQrModal: options.showQrModal ?? true,
  })

export const connectWalletConnectSigner = async (
  options: WalletConnectOptions,
): Promise<PortableSignerConnection> => {
  const provider = await createWalletConnectProvider(options)
  await provider.connect({
    chains: options.chains,
    ...(options.optionalChains && options.optionalChains.length > 0
      ? { optionalChains: options.optionalChains }
      : {}),
    rpcMap: normalizeRpcMap(options.rpcMap),
  })

  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from WalletConnect')
  }

  return {
    type: 'walletconnect',
    provider,
    address: normalizeAddress(accounts[0]),
  }
}

export const createLocalSigner = (): LocalSigner => {
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)

  return {
    type: 'local',
    address: account.address as HexAddress,
    privateKey: privateKey as HexData,
  }
}

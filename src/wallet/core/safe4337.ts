import { encodeFunctionData, parseAbi } from 'viem'

import { ZERO_ADDRESS } from '../constants'
import type { Call, ChainConfig, HexAddress, HexData } from '../types'

type Safe4337Contracts = {
  moduleAddress: HexAddress
  fallbackHandler: HexAddress
  setupHelper: HexAddress
}

const SAFE_SETUP_ABI = parseAbi([
  'function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)',
])
const SAFE_ENABLE_MODULE_ABI = parseAbi(['function enableModule(address module)'])
const SAFE_SET_FALLBACK_HANDLER_ABI = parseAbi(['function setFallbackHandler(address handler)'])
const SAFE_MODULE_SETUP_ABI = parseAbi(['function enableModules(address[] modules)'])

const isZeroAddress = (address?: HexAddress) => !address || address === ZERO_ADDRESS

const resolveSafe4337ModuleAddress = (chain: ChainConfig): HexAddress => {
  const moduleAddress = chain.safe4337Module
  if (isZeroAddress(moduleAddress)) {
    throw new Error('Safe4337Module address is required for ERC-4337 enablement')
  }

  return moduleAddress
}

export const resolveSafe4337FallbackHandler = (chain: ChainConfig): HexAddress => {
  const moduleAddress = resolveSafe4337ModuleAddress(chain)
  const fallbackHandler = chain.safe4337FallbackHandler ?? moduleAddress
  if (isZeroAddress(fallbackHandler)) {
    throw new Error('Safe4337 fallback handler address is required')
  }

  return fallbackHandler
}

export const resolveSafe4337Contracts = (chain: ChainConfig): Safe4337Contracts => {
  const moduleAddress = resolveSafe4337ModuleAddress(chain)
  const fallbackHandler = resolveSafe4337FallbackHandler(chain)
  const setupHelper = chain.safe4337SetupHelper
  if (isZeroAddress(setupHelper)) {
    throw new Error('Safe4337 setup helper address is required')
  }

  return {
    moduleAddress,
    fallbackHandler,
    setupHelper,
  }
}

export const buildSafe4337ModuleSetupCall = (chain: ChainConfig): Call => {
  const { moduleAddress, setupHelper } = resolveSafe4337Contracts(chain)
  const data = encodeFunctionData({
    abi: SAFE_MODULE_SETUP_ABI,
    functionName: 'enableModules',
    args: [[moduleAddress]],
  })

  return {
    to: setupHelper,
    data,
    value: 0n,
  }
}

export type SafeSetupParams = {
  owners: HexAddress[]
  threshold: number
  chain: ChainConfig
}

export const buildSafe4337SetupData = ({ owners, threshold, chain }: SafeSetupParams): HexData => {
  const moduleSetup = buildSafe4337ModuleSetupCall(chain)
  const { fallbackHandler } = resolveSafe4337Contracts(chain)

  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: 'setup',
    args: [
      owners,
      BigInt(threshold),
      moduleSetup.to,
      moduleSetup.data ?? '0x',
      fallbackHandler,
      ZERO_ADDRESS,
      0n,
      ZERO_ADDRESS,
    ],
  })
}

export type Safe4337EnableOptions = {
  includeFallbackHandler?: boolean
}

export const buildSafe4337EnableCalls = (
  safeAddress: HexAddress,
  chain: ChainConfig,
  options: Safe4337EnableOptions = {},
): Call[] => {
  const { moduleAddress, fallbackHandler } = resolveSafe4337Contracts(chain)
  const calls: Call[] = [
    {
      to: safeAddress,
      data: encodeFunctionData({
        abi: SAFE_ENABLE_MODULE_ABI,
        functionName: 'enableModule',
        args: [moduleAddress],
      }),
      value: 0n,
    },
  ]

  if (options.includeFallbackHandler) {
    calls.push({
      to: safeAddress,
      data: encodeFunctionData({
        abi: SAFE_SET_FALLBACK_HANDLER_ABI,
        functionName: 'setFallbackHandler',
        args: [fallbackHandler],
      }),
      value: 0n,
    })
  }

  return calls
}

export { resolveSafe4337ModuleAddress }

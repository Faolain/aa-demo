import { encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, pad, parseAbi } from 'viem'

import type { Call, HexAddress, HexData, ModuleAllowlistEntry } from '../types'

export const SOCIAL_RECOVERY_MODULE_ADDRESS =
  '0xA04D053b3C8021e8D5bF641816c42dAA75D8b597' as const satisfies HexAddress
export const SOCIAL_RECOVERY_BYTECODE_HASH =
  '0x00124da53e4f8a7502466e1ffe06be4df5002e069e4847b5f55888e2af1a952f' as const satisfies HexData
export const SENTINEL_ADDRESS =
  '0x0000000000000000000000000000000000000001' as const satisfies HexAddress

export const SOCIAL_RECOVERY_MODULE: ModuleAllowlistEntry = {
  address: SOCIAL_RECOVERY_MODULE_ADDRESS,
  moduleType: 'validator',
  name: 'Rhinestone Social Recovery',
}

export const ERC7579_ACCOUNT_ABI = parseAbi([
  'function installModule(uint256 moduleTypeId,address module,bytes initData)',
  'function uninstallModule(uint256 moduleTypeId,address module,bytes deInitData)',
  'function isModuleInstalled(uint256 moduleTypeId,address module,bytes additionalContext) view returns (bool)',
])

export const SOCIAL_RECOVERY_ABI = parseAbi([
  'function addGuardian(address guardian)',
  'function removeGuardian(address prevGuardian,address guardian)',
  'function setThreshold(uint256 threshold)',
  'function getGuardians(address account) view returns (address[])',
  'function threshold(address account) view returns (uint256)',
])

const VALIDATOR_MODULE_TYPE_ID = 1n

export const normalizeGuardianList = (guardians: HexAddress[]) => {
  const normalized = new Map<string, HexAddress>()
  for (const guardian of guardians) {
    const checksummed = getAddress(guardian) as HexAddress
    normalized.set(checksummed.toLowerCase(), checksummed)
  }
  return [...normalized.values()].sort((left, right) =>
    left.toLowerCase().localeCompare(right.toLowerCase()),
  )
}

export const buildSocialRecoveryInitData = ({
  guardians,
  threshold,
}: {
  guardians: HexAddress[]
  threshold: number
}): HexData =>
  encodeAbiParameters(
    [
      { name: 'threshold', type: 'uint256' },
      { name: 'guardians', type: 'address[]' },
    ],
    [BigInt(threshold), guardians],
  )

export const buildInstallSocialRecoveryModuleCall = ({
  safeAddress,
  moduleAddress,
  guardians,
  threshold,
}: {
  safeAddress: HexAddress
  moduleAddress: HexAddress
  guardians: HexAddress[]
  threshold: number
}): Call => ({
  to: safeAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: ERC7579_ACCOUNT_ABI,
    functionName: 'installModule',
    args: [VALIDATOR_MODULE_TYPE_ID, moduleAddress, buildSocialRecoveryInitData({ guardians, threshold })],
  }),
})

export const buildSetSocialRecoveryThresholdCall = (
  moduleAddress: HexAddress,
  threshold: number,
): Call => ({
  to: moduleAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: SOCIAL_RECOVERY_ABI,
    functionName: 'setThreshold',
    args: [BigInt(threshold)],
  }),
})

export const buildAddSocialRecoveryGuardianCall = (
  moduleAddress: HexAddress,
  guardian: HexAddress,
): Call => ({
  to: moduleAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: SOCIAL_RECOVERY_ABI,
    functionName: 'addGuardian',
    args: [guardian],
  }),
})

export const buildRemoveSocialRecoveryGuardianCall = (
  moduleAddress: HexAddress,
  prevGuardian: HexAddress,
  guardian: HexAddress,
): Call => ({
  to: moduleAddress,
  value: 0n,
  data: encodeFunctionData({
    abi: SOCIAL_RECOVERY_ABI,
    functionName: 'removeGuardian',
    args: [prevGuardian, guardian],
  }),
})

export const encodeGuardianSignatures = (signatures: HexData[], threshold: number) => {
  if (threshold <= 0) {
    throw new Error('Recovery threshold must be at least 1')
  }

  if (signatures.length < threshold) {
    throw new Error(`Expected ${threshold} guardian signatures, received ${signatures.length}`)
  }

  const selected = signatures.slice(0, threshold)
  return encodePacked(
    Array(selected.length).fill('bytes'),
    selected,
  )
}

export const encodeValidatorNonce = (validator: HexAddress): bigint =>
  BigInt(pad(validator, { dir: 'right', size: 24 }))

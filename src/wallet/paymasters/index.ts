import { ZERO_ADDRESS } from '../constants'
import type {
  ChainConfig,
  PaymasterMode,
  PaymasterStatus,
  Safe4337PaymasterOptions,
} from '../types'

export type PaymasterOverrides = {
  circle?: Safe4337PaymasterOptions
  sponsor?: Safe4337PaymasterOptions
}

export type PaymasterResolution = {
  options?: Safe4337PaymasterOptions
  available: boolean
  reason?: string
}

const isZeroAddress = (value?: string) => !value || value === ZERO_ADDRESS

const resolvePaymasterUrl = (primary?: string, bundlerUrl?: string) => {
  const trimmed = primary?.trim()
  if (trimmed) {
    return trimmed
  }
  return bundlerUrl?.trim()
}

export const PAYMASTER_MODE_LABELS: Record<PaymasterMode, string> = {
  sponsored: 'Sponsored',
  usdc: 'USDC',
  native: 'Native',
  auto: 'Auto',
}

export const PAYMASTER_MODE_DESCRIPTIONS: Record<PaymasterMode, string> = {
  sponsored: 'Fees covered by Demo sponsorship when eligible.',
  usdc: 'Gas paid in USDC via Circle Paymaster.',
  native: 'Gas paid in the chain native token.',
  auto: 'Auto-selects the best available paymaster.',
}

export const buildPaymasterStatus = ({
  requestedMode,
  resolvedMode,
  fallbackReason,
  paymasterUrl,
}: {
  requestedMode: PaymasterMode
  resolvedMode: PaymasterMode
  fallbackReason?: string
  paymasterUrl?: string
}): PaymasterStatus => ({
  requestedMode,
  resolvedMode,
  label: PAYMASTER_MODE_LABELS[resolvedMode],
  description: PAYMASTER_MODE_DESCRIPTIONS[resolvedMode],
  fallbackReason,
  paymasterUrl,
})

export const resolveCirclePaymasterOptions = (
  chain: ChainConfig,
  overrides: Safe4337PaymasterOptions | undefined,
  bundlerUrl?: string,
): PaymasterResolution => {
  const paymasterAddress = overrides?.paymasterAddress ?? chain.circlePaymaster
  const paymasterTokenAddress = overrides?.paymasterTokenAddress ?? chain.circlePaymasterToken
  const paymasterUrl = resolvePaymasterUrl(overrides?.paymasterUrl ?? chain.circlePaymasterUrl, bundlerUrl)

  if (!paymasterUrl) {
    return { available: false, reason: 'Circle paymaster URL is not configured.' }
  }

  if (isZeroAddress(paymasterAddress)) {
    return { available: false, reason: 'Circle paymaster address is missing.' }
  }

  if (isZeroAddress(paymasterTokenAddress)) {
    return { available: false, reason: 'USDC token address is missing.' }
  }

  return {
    available: true,
    options: {
      isSponsored: false,
      paymasterUrl,
      paymasterAddress,
      paymasterTokenAddress,
      amountToApprove: overrides?.amountToApprove,
    },
  }
}

export const resolveSponsorPaymasterOptions = (
  chain: ChainConfig,
  overrides: Safe4337PaymasterOptions | undefined,
  bundlerUrl?: string,
): PaymasterResolution => {
  const paymasterUrl = resolvePaymasterUrl(overrides?.paymasterUrl ?? chain.sponsorPaymasterUrl, bundlerUrl)

  if (!paymasterUrl) {
    return { available: false, reason: 'Sponsor paymaster URL is not configured.' }
  }

  return {
    available: true,
    options: {
      isSponsored: true,
      paymasterUrl,
      sponsorshipPolicyId: overrides?.sponsorshipPolicyId,
      paymasterContext: overrides?.paymasterContext,
    },
  }
}

import { SafeProvider, extractPasskeyData } from '@safe-global/protocol-kit'
import type {
  PasskeyArgType,
  PasskeyClient,
  SafeProviderConfig,
  SafeProviderInitOptions,
} from '@safe-global/protocol-kit'
import { getAddress } from 'viem'

import { buildContractNetworks } from '../chain'
import { SAFE_VERSION } from '../constants'
import type { ChainConfig, HexAddress, PasskeyMetadata } from '../types'

const DEFAULT_RP_NAME = 'Demo Wallet'
const DEFAULT_USER_NAME = 'demo-wallet'
const DEFAULT_USER_DISPLAY_NAME = 'Demo Wallet'
const DEFAULT_TIMEOUT_MS = 60_000

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

const toBufferSource = (value: Uint8Array | ArrayBuffer): ArrayBuffer => {
  if (value instanceof ArrayBuffer) {
    return value
  }

  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

const bufferToHex = (value: ArrayBuffer): string => {
  const bytes = new Uint8Array(value)
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
}

const normalizeRpId = (rpId: string) => rpId.trim().toLowerCase()

const resolveConfiguredRpId = () => {
  if (typeof import.meta === 'undefined') {
    return undefined
  }

  const env = import.meta.env as Record<string, string | undefined> | undefined
  return env?.VITE_WALLET_PASSKEY_RP_ID ?? env?.VITE_PASSKEY_RP_ID
}

const deriveRpIdFromHostname = (hostname: string) => {
  const lowered = hostname.toLowerCase()
  if (lowered === 'demo.fm' || lowered.endsWith('.demo.fm')) {
    return 'demo.fm'
  }
  if (lowered === 'localhost' || lowered === '127.0.0.1') {
    return lowered
  }

  return lowered
}

export const resolvePasskeyRpId = (rpId?: string) => {
  if (rpId) {
    return normalizeRpId(rpId)
  }

  const configured = resolveConfiguredRpId()
  if (configured) {
    return normalizeRpId(configured)
  }

  if (typeof window === 'undefined') {
    return undefined
  }

  return deriveRpIdFromHostname(window.location.hostname)
}

const getWebAuthnCredentials = () => {
  if (typeof window === 'undefined') {
    throw new Error('WebAuthn is not available outside the browser')
  }

  if (!window.navigator?.credentials?.create) {
    throw new Error('WebAuthn is not available in this environment')
  }

  return window.navigator.credentials
}

export type PasskeyCreationOptions = {
  rpId?: string
  rpName?: string
  userName?: string
  userDisplayName?: string
  userId?: Uint8Array | ArrayBuffer
  challenge?: Uint8Array | ArrayBuffer
  timeoutMs?: number
  attestation?: AttestationConveyancePreference
  authenticatorSelection?: AuthenticatorSelectionCriteria
}

export const createPasskeyCredential = async (
  options: PasskeyCreationOptions = {},
): Promise<PublicKeyCredential> => {
  const credentials = getWebAuthnCredentials()
  const rpId = resolvePasskeyRpId(options.rpId)
  const publicKey: PublicKeyCredentialCreationOptions = {
    rp: {
      name: options.rpName ?? DEFAULT_RP_NAME,
      ...(rpId ? { id: rpId } : {}),
    },
    user: {
      id: options.userId ? toBufferSource(options.userId) : toBufferSource(randomBytes(32)),
      name: options.userName ?? DEFAULT_USER_NAME,
      displayName: options.userDisplayName ?? DEFAULT_USER_DISPLAY_NAME,
    },
    challenge: options.challenge ? toBufferSource(options.challenge) : toBufferSource(randomBytes(32)),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: options.authenticatorSelection ?? {
      residentKey: 'required',
      userVerification: 'required',
    },
    attestation: options.attestation ?? 'none',
    timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }

  const credential = await credentials.create({ publicKey })

  if (!credential) {
    throw new Error('Passkey creation was cancelled')
  }

  if (credential.type !== 'public-key') {
    throw new Error('Unexpected passkey credential type')
  }

  return credential as PublicKeyCredential
}

export const passkeyMetadataFromCredential = async (
  credential: Credential,
  options: { rpId?: string } = {},
): Promise<PasskeyMetadata> => {
  const passkey = await extractPasskeyData(credential)
  const fallbackRawId =
    credential && 'rawId' in credential && (credential as PublicKeyCredential).rawId
      ? bufferToHex((credential as PublicKeyCredential).rawId)
      : undefined
  const candidateRawId = fallbackRawId ?? passkey.rawId
  const rawId =
    candidateRawId && /^[0-9a-f]+$/i.test(candidateRawId) ? candidateRawId : passkey.rawId
  if (!rawId) {
    throw new Error('Failed to extract passkey rawId')
  }
  if (!passkey.coordinates?.x || !passkey.coordinates?.y) {
    throw new Error('Failed to extract passkey coordinates')
  }
  const rpId = resolvePasskeyRpId(options.rpId)
  return {
    rawId,
    publicKey: {
      x: passkey.coordinates.x,
      y: passkey.coordinates.y,
    },
    ...(rpId ? { rpId } : {}),
  }
}

const isHexString = (value: string) => /^[0-9a-f]+$/i.test(value)
const isHexPrefixed = (value: string) => /^0x[0-9a-f]+$/i.test(value)

export const isValidPasskeyMetadata = (passkey?: PasskeyMetadata | null): passkey is PasskeyMetadata => {
  if (!passkey) return false
  if (!passkey.rawId || !isHexString(passkey.rawId)) return false
  if (!passkey.publicKey?.x || !isHexPrefixed(passkey.publicKey.x)) return false
  if (!passkey.publicKey?.y || !isHexPrefixed(passkey.publicKey.y)) return false
  return true
}

const assertValidPasskeyMetadata = (passkey: PasskeyMetadata) => {
  if (!isValidPasskeyMetadata(passkey)) {
    throw new Error('Passkey metadata is missing a valid rawId or public key coordinates')
  }
}

export const createPasskeyMetadata = async (
  options: PasskeyCreationOptions = {},
): Promise<PasskeyMetadata> => {
  const credential = await createPasskeyCredential(options)
  return passkeyMetadataFromCredential(credential, { rpId: options.rpId })
}

export const passkeyMetadataToArg = (
  passkey: PasskeyMetadata,
  verifierAddress?: HexAddress,
): PasskeyArgType => ({
  rawId: passkey.rawId,
  coordinates: {
    x: passkey.publicKey.x,
    y: passkey.publicKey.y,
  },
  ...(verifierAddress ? { customVerifierAddress: verifierAddress } : {}),
})

export type PasskeySignerInfo = {
  passkey: PasskeyArgType
  address: HexAddress
  signer: PasskeyClient
  safeProvider: SafeProvider
}

const isPasskeyClient = (value: unknown): value is PasskeyClient =>
  !!value && typeof (value as PasskeyClient).createDeployTxRequest === 'function'

export type ResolvePasskeySignerParams = {
  chain: ChainConfig
  provider: SafeProviderConfig['provider']
  passkey: PasskeyMetadata
  safeVersion?: SafeProviderInitOptions['safeVersion']
  safeAddress?: HexAddress
  owners?: HexAddress[]
}

export const resolvePasskeySigner = async (
  params: ResolvePasskeySignerParams,
): Promise<PasskeySignerInfo> => {
  assertValidPasskeyMetadata(params.passkey)
  const passkeyArg = passkeyMetadataToArg(params.passkey, params.chain.passkeyVerifier)
  const contractNetworks = buildContractNetworks(params.chain)
  const safeProvider = await SafeProvider.init({
    provider: params.provider,
    signer: passkeyArg,
    safeVersion: params.safeVersion ?? SAFE_VERSION,
    contractNetworks,
    safeAddress: params.safeAddress,
    owners: params.owners,
  })
  const signer = await safeProvider.getExternalSigner()

  if (!isPasskeyClient(signer)) {
    throw new Error('Failed to initialize passkey signer')
  }

  const address = getAddress(signer.account.address) as HexAddress

  return {
    passkey: passkeyArg,
    address,
    signer,
    safeProvider,
  }
}

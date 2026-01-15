import type { EncryptedPayload, StorageCrypto } from './types'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const hkdfInfo = textEncoder.encode('demo-wallet-storage')

const toBase64 = (bytes: Uint8Array) => {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const fromBase64 = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const toBase64Url = (bytes: Uint8Array) =>
  toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

const fromBase64Url = (base64Url: string) => {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (base64.length % 4)) % 4
  base64 += '='.repeat(padding)
  return fromBase64(base64)
}

const deriveKey = async (secret: Uint8Array, salt: Uint8Array) => {
  const secretBytes = new Uint8Array(secret)
  const saltBytes = new Uint8Array(salt)
  const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: hkdfInfo,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export const createStorageCrypto = async (
  secret: Uint8Array,
): Promise<StorageCrypto> => ({
  encrypt: async (plaintext: string) => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await deriveKey(secret, salt)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      textEncoder.encode(plaintext),
    )

    return {
      version: 1,
      iv: toBase64Url(iv),
      salt: toBase64Url(salt),
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    }
  },
  decrypt: async (payload: EncryptedPayload) => {
    const iv = fromBase64Url(payload.iv)
    const salt = fromBase64Url(payload.salt)
    const ciphertext = fromBase64Url(payload.ciphertext)
    const key = await deriveKey(secret, salt)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    )
    return textDecoder.decode(plaintext)
  },
})

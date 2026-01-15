import type {
  EncryptedPayload,
  StorageCrypto,
  WalletChainState,
  WalletChainStateUpdate,
  WalletDeploymentConfigUpdate,
  WalletOwnerConfigUpdate,
  WalletOverridesUpdate,
  WalletState,
  WalletStatePayload,
  WalletStorageOptions,
} from './types'
import { WALLET_STORAGE_VERSION } from './types'

const DB_NAME = 'demo-wallet'
const DB_VERSION = 1
const STORE_NAME = 'wallet-state'
const RECORD_KEY = 'default'

type WalletStateRecord = {
  version: number
  updatedAt: string
  encrypted: boolean
  payload: WalletStatePayload | EncryptedPayload
}

const now = () => new Date().toISOString()

const createDefaultPayload = (): WalletStatePayload => ({
  passkeys: [],
  chainState: {},
  overrides: {},
  deploymentConfigByChain: {},
})

const normalizePayload = (payload: Partial<WalletStatePayload> = {}): WalletStatePayload => ({
  passkeys: payload.passkeys ?? [],
  ownerConfig: payload.ownerConfig,
  recovery: payload.recovery,
  chainState: payload.chainState ?? {},
  overrides: payload.overrides ?? {},
  deploymentConfigByChain: payload.deploymentConfigByChain ?? {},
})

const createState = (payload: WalletStatePayload): WalletState => ({
  version: WALLET_STORAGE_VERSION,
  updatedAt: now(),
  ...payload,
})

const openWalletDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })

const readRecord = async (): Promise<WalletStateRecord | null> => {
  const db = await openWalletDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(RECORD_KEY)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve((request.result as WalletStateRecord) ?? null)
  })
}

const writeRecord = async (record: WalletStateRecord) => {
  const db = await openWalletDb()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(record, RECORD_KEY)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

const decodePayload = async (
  record: WalletStateRecord,
  crypto?: StorageCrypto,
): Promise<WalletStatePayload> => {
  if (!record.encrypted) {
    return normalizePayload(record.payload as WalletStatePayload)
  }

  if (!crypto) {
    throw new Error('Encrypted wallet storage requires crypto provider')
  }

  const decrypted = await crypto.decrypt(record.payload as EncryptedPayload)
  return normalizePayload(JSON.parse(decrypted) as WalletStatePayload)
}

const encodePayload = async (
  payload: WalletStatePayload,
  crypto?: StorageCrypto,
): Promise<WalletStateRecord> => {
  if (!crypto) {
    return {
      version: WALLET_STORAGE_VERSION,
      updatedAt: now(),
      encrypted: false,
      payload,
    }
  }

  const plaintext = JSON.stringify(payload)
  const encrypted = await crypto.encrypt(plaintext)
  return {
    version: WALLET_STORAGE_VERSION,
    updatedAt: now(),
    encrypted: true,
    payload: encrypted,
  }
}

const migrateRecord = async (
  record: WalletStateRecord,
  crypto?: StorageCrypto,
): Promise<WalletState> => {
  const payload = await decodePayload(record, crypto)
  return createState(payload)
}

const mergeChainState = (
  current: WalletChainState | undefined,
  patch: Partial<WalletChainState>,
): WalletChainState => ({
  ...(current ?? {}),
  ...patch,
})

export const getWalletState = async (
  options: WalletStorageOptions = {},
): Promise<WalletState | null> => {
  const record = await readRecord()
  if (!record) {
    return null
  }

  const state = await migrateRecord(record, options.crypto)
  if (record.version !== WALLET_STORAGE_VERSION) {
    const nextRecord = await encodePayload(normalizePayload(state), options.crypto)
    await writeRecord(nextRecord)
  }

  return state
}

export const setWalletState = async (
  payload: WalletStatePayload,
  options: WalletStorageOptions = {},
): Promise<WalletState> => {
  const normalized = normalizePayload(payload)
  const record = await encodePayload(normalized, options.crypto)
  await writeRecord(record)
  return createState(normalized)
}

export const updateWalletState = async (
  updater: (current: WalletState) => WalletStatePayload,
  options: WalletStorageOptions = {},
): Promise<WalletState> => {
  const current = (await getWalletState(options)) ?? createState(createDefaultPayload())
  const nextPayload = normalizePayload(updater(current))
  const record = await encodePayload(nextPayload, options.crypto)
  await writeRecord(record)
  return createState(nextPayload)
}

export const setOwnerConfig = async (
  update: WalletOwnerConfigUpdate,
  options: WalletStorageOptions = {},
) =>
  updateWalletState((current) => {
    const nextOwnerConfig = update.ownerConfig
    return {
      ...current,
      ownerConfig: nextOwnerConfig,
    }
  }, options)

export const setChainState = async (
  update: WalletChainStateUpdate,
  options: WalletStorageOptions = {},
) =>
  updateWalletState((current) => {
    const chainKey = String(update.chainId)
    return {
      ...current,
      chainState: {
        ...current.chainState,
        [chainKey]: mergeChainState(current.chainState[chainKey], update.state),
      },
    }
  }, options)

export const setChainOverrides = async (
  update: WalletOverridesUpdate,
  options: WalletStorageOptions = {},
) =>
  updateWalletState((current) => {
    const chainKey = String(update.chainId)
    return {
      ...current,
      overrides: {
        ...current.overrides,
        [chainKey]: update.overrides,
      },
    }
  }, options)

export const setDeploymentConfig = async (
  update: WalletDeploymentConfigUpdate,
  options: WalletStorageOptions = {},
) =>
  updateWalletState((current) => {
    const chainKey = String(update.chainId)
    return {
      ...current,
      deploymentConfigByChain: {
        ...current.deploymentConfigByChain,
        [chainKey]: update.deployment,
      },
    }
  }, options)

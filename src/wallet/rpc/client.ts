import type { HexAddress, HexData } from '../types'

export type RpcClientOptions = {
  urls: string[]
  timeoutMs?: number
  headers?: Record<string, string>
  rotateOnError?: boolean
  healthCheckIntervalMs?: number
  maxBackoffMs?: number
  baseBackoffMs?: number
}

export type RpcRequestOptions = {
  timeoutMs?: number
  maxAttempts?: number
  headers?: Record<string, string>
  signal?: AbortSignal
  endpointUrl?: string
  healthCheck?: boolean
  requireHealthy?: boolean
}

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000
const DEFAULT_BACKOFF_MS = 5_000
const DEFAULT_MAX_BACKOFF_MS = 120_000

const normalizeUrls = (urls: string[]) => Array.from(new Set(urls.filter(Boolean)))

const attachAbortSignal = (controller: AbortController, signal?: AbortSignal) => {
  if (!signal) {
    return
  }

  if (signal.aborted) {
    controller.abort()
    return
  }

  signal.addEventListener('abort', () => controller.abort(), { once: true })
}

type RpcEndpointState = {
  url: string
  lastCheckedAt?: number
  latencyMs?: number
  unhealthyUntil?: number
  failures: number
  lastError?: string
  chainId?: HexData
}

export class RpcClient {
  private readonly urls: string[]
  private readonly timeoutMs: number
  private readonly headers?: Record<string, string>
  private readonly rotateOnError: boolean
  private readonly healthCheckIntervalMs: number
  private readonly maxBackoffMs: number
  private readonly baseBackoffMs: number
  private cursor = 0
  private requestId = 0
  private readonly endpointState = new Map<string, RpcEndpointState>()
  private lastEndpointUrl?: string

  constructor(options: RpcClientOptions) {
    this.urls = normalizeUrls(options.urls)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.headers = options.headers
    this.rotateOnError = options.rotateOnError ?? true
    this.healthCheckIntervalMs =
      options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BACKOFF_MS

    if (this.urls.length === 0) {
      throw new Error('RpcClient requires at least one endpoint')
    }

    for (const url of this.urls) {
      this.endpointState.set(url, {
        url,
        failures: 0,
      })
    }
  }

  getEndpointUrls() {
    return [...this.urls]
  }

  getActiveUrl() {
    return this.lastEndpointUrl ?? this.urls[this.cursor % this.urls.length]
  }

  async selectEndpoint(options: RpcRequestOptions = {}) {
    const endpoints = options.endpointUrl
      ? this.urls.filter((url) => url === options.endpointUrl)
      : this.urls

    if (endpoints.length === 0) {
      throw new Error('No RPC endpoints available')
    }

    const maxAttempts = Math.min(options.maxAttempts ?? endpoints.length, endpoints.length)
    const requireHealthy = options.requireHealthy ?? true
    const now = Date.now()

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const index = (this.cursor + attempt) % endpoints.length
      const url = endpoints[index]
      const state = this.getEndpointState(url)

      if (requireHealthy && this.isEndpointUnhealthy(state, now)) {
        continue
      }

      if (options.healthCheck ?? true) {
        await this.ensureEndpointHealth(url, options)
      }

      this.cursor = index
      this.lastEndpointUrl = url
      return url
    }

    const fallback = endpoints[this.cursor % endpoints.length]
    this.lastEndpointUrl = fallback
    return fallback
  }

  async request<T>(method: string, params: unknown[] = [], options: RpcRequestOptions = {}) {
    let lastError: unknown

    const endpoints = options.endpointUrl
      ? this.urls.filter((url) => url === options.endpointUrl)
      : this.urls

    if (endpoints.length === 0) {
      throw new Error('No RPC endpoints available')
    }

    const attempts = Math.min(options.maxAttempts ?? endpoints.length, endpoints.length)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const index = (this.cursor + attempt) % endpoints.length
      const url = endpoints[index]

      if (options.healthCheck ?? true) {
        await this.ensureEndpointHealth(url, options)
      }

      try {
        const result = await this.sendRequest<T>(url, method, params, options)
        this.cursor = index
        this.lastEndpointUrl = url
        this.markEndpointHealthy(url)
        return result
      } catch (error) {
        lastError = error
        this.markEndpointFailure(url, error)
        if (!this.rotateOnError) {
          break
        }
      }
    }

    throw lastError ?? new Error('RPC request failed')
  }

  async getChainId(options: RpcRequestOptions = {}) {
    return this.request<HexData>('eth_chainId', [], options)
  }

  async getCode(address: HexAddress, blockTag: HexData | 'latest' = 'latest') {
    return this.request<HexData>('eth_getCode', [address, blockTag], { healthCheck: false })
  }

  async getBalance(address: HexAddress, blockTag: HexData | 'latest' = 'latest') {
    return this.request<HexData>('eth_getBalance', [address, blockTag], { healthCheck: false })
  }

  async call(
    transaction: { to: HexAddress; data?: HexData; value?: HexData },
    blockTag: HexData | 'latest' = 'latest',
  ) {
    return this.request<HexData>('eth_call', [transaction, blockTag], { healthCheck: false })
  }

  markEndpointFailure(url: string, error?: unknown) {
    const state = this.endpointState.get(url)
    if (!state) {
      return
    }

    state.failures += 1
    const backoff = Math.min(this.baseBackoffMs * 2 ** (state.failures - 1), this.maxBackoffMs)
    state.unhealthyUntil = Date.now() + backoff
    state.lastCheckedAt = Date.now()
    state.lastError = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  }

  markEndpointHealthy(url: string) {
    const state = this.endpointState.get(url)
    if (!state) {
      return
    }

    state.failures = 0
    state.unhealthyUntil = undefined
    state.lastError = undefined
  }

  private async sendRequest<T>(
    url: string,
    method: string,
    params: unknown[],
    options: RpcRequestOptions,
  ) {
    const requestId = this.requestId
    this.requestId += 1

    const controller = new AbortController()
    attachAbortSignal(controller, options.signal)

    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.headers,
          ...options.headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method,
          params,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`RPC responded with ${response.status}`)
      }

      const payload = (await response.json()) as
        | { jsonrpc: '2.0'; id: number; result: T }
        | { jsonrpc: '2.0'; id: number; error: { code: number; message: string } }

      if ('error' in payload) {
        throw new Error(payload.error.message)
      }

      return payload.result
    } finally {
      clearTimeout(timeout)
    }
  }

  private getEndpointState(url: string): RpcEndpointState {
    const existing = this.endpointState.get(url)
    if (existing) {
      return existing
    }

    const state: RpcEndpointState = {
      url,
      failures: 0,
    }
    this.endpointState.set(url, state)
    return state
  }

  private isEndpointUnhealthy(state: RpcEndpointState, now: number) {
    return typeof state.unhealthyUntil === 'number' && state.unhealthyUntil > now
  }

  private shouldRefresh(state: RpcEndpointState, now: number) {
    if (!state.lastCheckedAt) {
      return true
    }

    return now - state.lastCheckedAt > this.healthCheckIntervalMs
  }

  private async ensureEndpointHealth(url: string, options: RpcRequestOptions) {
    const state = this.getEndpointState(url)
    const now = Date.now()

    if (this.isEndpointUnhealthy(state, now)) {
      return
    }

    if (!this.shouldRefresh(state, now)) {
      return
    }

    const startedAt = Date.now()
    try {
      const chainId = await this.sendRequest<HexData>(url, 'eth_chainId', [], options)
      state.chainId = chainId
      state.lastCheckedAt = Date.now()
      state.latencyMs = Date.now() - startedAt
      this.markEndpointHealthy(url)
    } catch (error) {
      state.latencyMs = Date.now() - startedAt
      this.markEndpointFailure(url, error)
    }
  }
}

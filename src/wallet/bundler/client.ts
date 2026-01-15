import type { BundlerEndpoint, HexAddress, HexData } from '../types'

export type BundlerRpcErrorPayload = {
  code: number
  message: string
  data?: unknown
}

export class BundlerRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  readonly endpoint: string
  readonly method: string

  constructor(payload: BundlerRpcErrorPayload, endpoint: string, method: string) {
    super(payload.message)
    this.code = payload.code
    this.data = payload.data
    this.endpoint = endpoint
    this.method = method
  }
}

export type BundlerRpcResponse<T> =
  | {
      jsonrpc: '2.0'
      id: number
      result: T
    }
  | {
      jsonrpc: '2.0'
      id: number
      error: BundlerRpcErrorPayload
    }

export type BundlerClientOptions = {
  endpoints: BundlerEndpoint[] | string[]
  timeoutMs?: number
  headers?: Record<string, string>
  rotateOnError?: boolean
  healthCheckIntervalMs?: number
  maxBackoffMs?: number
  baseBackoffMs?: number
}

export type BundlerRequestOptions = {
  entryPoint?: HexAddress
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

const normalizeEndpoints = (endpoints: BundlerEndpoint[] | string[]): BundlerEndpoint[] =>
  endpoints.map((endpoint) =>
    typeof endpoint === 'string' ? { url: endpoint, entryPoints: [] } : endpoint,
  )

const resolveEndpoints = (endpoints: BundlerEndpoint[], entryPoint?: HexAddress) => {
  if (!entryPoint) {
    return endpoints
  }

  return endpoints.filter((endpoint) =>
    endpoint.entryPoints.length === 0 ? true : endpoint.entryPoints.includes(entryPoint),
  )
}

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

type BundlerEndpointState = {
  url: string
  entryPoints: HexAddress[]
  lastCheckedAt?: number
  latencyMs?: number
  unhealthyUntil?: number
  failures: number
  lastError?: string
}

export class BundlerClient {
  private readonly endpoints: BundlerEndpoint[]
  private readonly timeoutMs: number
  private readonly headers?: Record<string, string>
  private readonly rotateOnError: boolean
  private readonly healthCheckIntervalMs: number
  private readonly maxBackoffMs: number
  private readonly baseBackoffMs: number
  private cursor = 0
  private requestId = 0
  private readonly endpointState = new Map<string, BundlerEndpointState>()
  private lastEndpointUrl?: string

  constructor(options: BundlerClientOptions) {
    this.endpoints = normalizeEndpoints(options.endpoints)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.headers = options.headers
    this.rotateOnError = options.rotateOnError ?? true
    this.healthCheckIntervalMs =
      options.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
    this.baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BACKOFF_MS

    if (this.endpoints.length === 0) {
      throw new Error('BundlerClient requires at least one endpoint')
    }

    for (const endpoint of this.endpoints) {
      this.endpointState.set(endpoint.url, {
        url: endpoint.url,
        entryPoints: endpoint.entryPoints ?? [],
        failures: 0,
      })
    }
  }

  getEndpointUrls() {
    return this.endpoints.map((endpoint) => endpoint.url)
  }

  getLastEndpointUrl() {
    return this.lastEndpointUrl
  }

  async selectEndpoint(options: BundlerRequestOptions = {}) {
    const eligibleEndpoints = resolveEndpoints(this.endpoints, options.entryPoint)

    if (eligibleEndpoints.length === 0) {
      throw new Error('No bundler endpoints available for entry point')
    }

    const maxAttempts = Math.min(
      options.maxAttempts ?? eligibleEndpoints.length,
      eligibleEndpoints.length,
    )

    const requireHealthy = options.requireHealthy ?? true
    const now = Date.now()

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const index = (this.cursor + attempt) % eligibleEndpoints.length
      const endpoint = eligibleEndpoints[index]
      const state = this.getEndpointState(endpoint)

      if (requireHealthy && this.isEndpointUnhealthy(state, now)) {
        continue
      }

      if (options.healthCheck ?? true) {
        await this.ensureEndpointHealth(endpoint, options)
      }

      if (
        options.entryPoint &&
        state.entryPoints.length > 0 &&
        !state.entryPoints.includes(options.entryPoint)
      ) {
        continue
      }

      this.cursor = index
      this.lastEndpointUrl = endpoint.url
      return endpoint
    }

    const fallback = eligibleEndpoints[this.cursor % eligibleEndpoints.length]
    this.lastEndpointUrl = fallback.url
    return fallback
  }

  async request<T>(method: string, params: unknown[] = [], options: BundlerRequestOptions = {}) {
    let lastError: unknown

    const endpointUrl = options.endpointUrl
    const maxAttempts = options.maxAttempts
    const endpoints = endpointUrl
      ? this.endpoints.filter((endpoint) => endpoint.url === endpointUrl)
      : resolveEndpoints(this.endpoints, options.entryPoint)

    if (endpoints.length === 0) {
      throw new Error('No bundler endpoints available for entry point')
    }

    const attempts = Math.min(maxAttempts ?? endpoints.length, endpoints.length)

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const index = (this.cursor + attempt) % endpoints.length
      const endpoint = endpoints[index]
      const state = this.getEndpointState(endpoint)

      if (options.healthCheck ?? true) {
        await this.ensureEndpointHealth(endpoint, options)
      }

      if (
        options.entryPoint &&
        state.entryPoints.length > 0 &&
        !state.entryPoints.includes(options.entryPoint)
      ) {
        continue
      }

      try {
        const result = await this.sendRequest<T>(endpoint.url, method, params, options)
        this.cursor = index
        this.lastEndpointUrl = endpoint.url
        this.markEndpointHealthy(endpoint.url)
        return result
      } catch (error) {
        lastError = error
        this.markEndpointFailure(endpoint.url, error)
        if (!this.rotateOnError) {
          break
        }
      }
    }

    throw lastError ?? new Error('Bundler request failed')
  }

  async sendUserOperation(
    userOperation: Record<string, unknown>,
    entryPoint: HexAddress,
    options: BundlerRequestOptions = {},
  ) {
    return this.request<HexData>('eth_sendUserOperation', [userOperation, entryPoint], {
      ...options,
      entryPoint,
    })
  }

  async getUserOperationReceipt(userOpHash: HexData, options: BundlerRequestOptions = {}) {
    return this.request<Record<string, unknown> | null>(
      'eth_getUserOperationReceipt',
      [userOpHash],
      options,
    )
  }

  async getSupportedEntryPoints(options: BundlerRequestOptions = {}) {
    return this.request<HexAddress[]>('eth_supportedEntryPoints', [], {
      ...options,
      healthCheck: false,
    })
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
    options: BundlerRequestOptions,
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
        throw new Error(`Bundler responded with ${response.status}`)
      }

      const payload = (await response.json()) as BundlerRpcResponse<T>

      if ('error' in payload) {
        throw new BundlerRpcError(payload.error, url, method)
      }

      return payload.result
    } finally {
      clearTimeout(timeout)
    }
  }

  private getEndpointState(endpoint: BundlerEndpoint): BundlerEndpointState {
    const existing = this.endpointState.get(endpoint.url)
    if (existing) {
      if (existing.entryPoints.length === 0 && endpoint.entryPoints.length > 0) {
        existing.entryPoints = endpoint.entryPoints
      }
      return existing
    }

    const state: BundlerEndpointState = {
      url: endpoint.url,
      entryPoints: endpoint.entryPoints ?? [],
      failures: 0,
    }
    this.endpointState.set(endpoint.url, state)
    return state
  }

  private isEndpointUnhealthy(state: BundlerEndpointState, now: number) {
    return typeof state.unhealthyUntil === 'number' && state.unhealthyUntil > now
  }

  private shouldRefresh(state: BundlerEndpointState, now: number) {
    if (!state.lastCheckedAt) {
      return true
    }

    return now - state.lastCheckedAt > this.healthCheckIntervalMs
  }

  private async ensureEndpointHealth(endpoint: BundlerEndpoint, options: BundlerRequestOptions) {
    const state = this.getEndpointState(endpoint)
    const now = Date.now()

    if (this.isEndpointUnhealthy(state, now)) {
      return
    }

    if (!this.shouldRefresh(state, now)) {
      return
    }

    const startedAt = Date.now()
    try {
      const entryPoints = await this.sendRequest<HexAddress[]>(
        endpoint.url,
        'eth_supportedEntryPoints',
        [],
        options,
      )
      state.entryPoints = entryPoints ?? state.entryPoints
      state.lastCheckedAt = Date.now()
      state.latencyMs = Date.now() - startedAt
      this.markEndpointHealthy(endpoint.url)
    } catch (error) {
      state.latencyMs = Date.now() - startedAt
      this.markEndpointFailure(endpoint.url, error)
    }
  }
}

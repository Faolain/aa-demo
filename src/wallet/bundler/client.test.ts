import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HexAddress } from '../types'
import { BundlerClient } from './client'

const entryPoint = '0x0000000000000000000000000000000000000001' as HexAddress

const jsonRpcResult = (result: unknown) =>
  ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0' as const,
      id: 0,
      result,
    }),
  }) as Response

describe('BundlerClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('selectEndpoint skips unhealthy endpoints and respects entryPoint filters', async () => {
    const client = new BundlerClient({
      endpoints: [
        { url: 'https://bundler-a.test', entryPoints: [entryPoint] },
        { url: 'https://bundler-b.test', entryPoints: [] },
      ],
    })

    client.markEndpointFailure('https://bundler-a.test', new Error('fail'))

    const endpoint = await client.selectEndpoint({ entryPoint, healthCheck: false })
    expect(endpoint.url).toBe('https://bundler-b.test')
    expect(client.getLastEndpointUrl()).toBe('https://bundler-b.test')
  })

  it('rotates endpoints on request failures', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (url) => {
      if (url === 'https://bundler-a.test') {
        return { ok: false, status: 500 } as Response
      }
      return jsonRpcResult(['0xdeadbeef'])
    })

    const client = new BundlerClient({
      endpoints: ['https://bundler-a.test', 'https://bundler-b.test'],
    })

    const result = await client.request<HexAddress[]>('eth_supportedEntryPoints')
    expect(result).toEqual(['0xdeadbeef'])
    expect(client.getLastEndpointUrl()).toBe('https://bundler-b.test')
  })

  it('caches health checks until the refresh interval elapses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => jsonRpcResult([entryPoint]))

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const client = new BundlerClient({
      endpoints: ['https://bundler-a.test'],
      healthCheckIntervalMs: 60_000,
    })

    await client.selectEndpoint()
    await client.selectEndpoint()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2024-01-01T00:02:00.000Z'))

    await client.selectEndpoint()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

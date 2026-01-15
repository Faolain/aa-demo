import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HexAddress } from '../types'
import { RpcClient } from './client'

const jsonRpcResult = (result: unknown) =>
  ({
    ok: true,
    json: async () => ({
      jsonrpc: '2.0' as const,
      id: 0,
      result,
    }),
  }) as Response

const address = '0x000000000000000000000000000000000000beef' as HexAddress

describe('RpcClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('rotates endpoints on request failures', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (url) => {
      if (url === 'https://rpc-a.test') {
        return { ok: false, status: 500 } as Response
      }
      return jsonRpcResult('0x1')
    })

    const client = new RpcClient({ urls: ['https://rpc-a.test', 'https://rpc-b.test'] })
    const result = await client.request<string>('eth_chainId', [], { healthCheck: false })

    expect(result).toBe('0x1')
    expect(client.getActiveUrl()).toBe('https://rpc-b.test')
  })

  it('caches health checks until the refresh interval elapses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async () => jsonRpcResult('0x1'))

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const client = new RpcClient({
      urls: ['https://rpc-a.test'],
      healthCheckIntervalMs: 60_000,
    })

    await client.selectEndpoint()
    await client.selectEndpoint()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2024-01-01T00:02:00.000Z'))

    await client.selectEndpoint()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('getCode bypasses health checks and calls eth_getCode', async () => {
    const methods: string[] = []
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation(async (_url, options) => {
      const payload = JSON.parse(options?.body as string) as { method: string }
      methods.push(payload.method)
      return jsonRpcResult('0x')
    })

    const client = new RpcClient({ urls: ['https://rpc-a.test'] })
    await client.getCode(address)

    expect(methods).toEqual(['eth_getCode'])
  })
})

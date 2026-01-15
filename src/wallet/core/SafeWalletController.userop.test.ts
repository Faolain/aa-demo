import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChainConfig, HexAddress, HexData } from '../types'
import { SafeWalletController } from './SafeWalletController'
import { updateWalletState } from '../storage'

const updateWalletStateMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../storage', () => ({
  getWalletState: vi.fn().mockResolvedValue(null),
  setChainOverrides: vi.fn(),
  updateWalletState: updateWalletStateMock,
}))

const makeChain = (): ChainConfig => ({
  chainId: 1,
  name: 'Test',
  rpcUrls: [],
  entryPoint: '0x0000000000000000000000000000000000000001' as HexAddress,
  safeSingleton: '0x0000000000000000000000000000000000000002' as HexAddress,
  safeProxyFactory: '0x0000000000000000000000000000000000000003' as HexAddress,
  safe4337Module: '0x0000000000000000000000000000000000000004' as HexAddress,
  safe4337FallbackHandler: '0x0000000000000000000000000000000000000005' as HexAddress,
  safe4337SetupHelper: '0x0000000000000000000000000000000000000006' as HexAddress,
})

describe('SafeWalletController.waitForUserOperationReceipt', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('polls until a receipt is available and updates chain state on success', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const controller = new SafeWalletController({
      chain: makeChain(),
      provider: {},
      signer: {},
      safeAddress: '0x000000000000000000000000000000000000cafe' as HexAddress,
    })

    const receipt = { success: true } as { success: boolean }
    const getReceiptSpy = vi
      .spyOn(controller, 'getUserOperationReceipt')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(receipt as unknown as never)

    const promise = controller.waitForUserOperationReceipt('0xdead' as HexData, {
      pollIntervalMs: 10,
      timeoutMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(10)
    const result = await promise

    expect(result).toBe(receipt)
    expect(getReceiptSpy).toHaveBeenCalledTimes(2)
    expect(updateWalletState).toHaveBeenCalled()
  })

  it('throws after timing out without a receipt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))

    const controller = new SafeWalletController({
      chain: makeChain(),
      provider: {},
      signer: {},
    })

    vi.spyOn(controller, 'getUserOperationReceipt').mockResolvedValue(null)

    const promise = controller.waitForUserOperationReceipt('0xbeef' as HexData, {
      pollIntervalMs: 10,
      timeoutMs: 25,
    })
    const assertion = expect(promise).rejects.toThrow('Timed out')

    await vi.advanceTimersByTimeAsync(30)

    await assertion
    expect(updateWalletState).not.toHaveBeenCalled()
  })
})

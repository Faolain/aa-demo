import { afterEach, describe, expect, it, vi } from 'vitest'
import { BestEffortFeeEstimator } from './feeEstimator'

const pimlicoPre = vi.hoisted(() => vi.fn())
const pimlicoPost = vi.hoisted(() => vi.fn())
const genericPre = vi.hoisted(() => vi.fn())
const genericPost = vi.hoisted(() => vi.fn())

vi.mock('@safe-global/relay-kit', () => ({
  GenericFeeEstimator: class {
    constructor(rpcUrl: string) {
      void rpcUrl
    }
    preEstimateUserOperationGas = genericPre
    postEstimateUserOperationGas = genericPost
  },
  PimlicoFeeEstimator: class {
    preEstimateUserOperationGas = pimlicoPre
    postEstimateUserOperationGas = pimlicoPost
  },
}))

describe('BestEffortFeeEstimator', () => {
  afterEach(() => {
    pimlicoPre.mockReset()
    pimlicoPost.mockReset()
    genericPre.mockReset()
    genericPost.mockReset()
  })

  it('uses Pimlico estimator when bundler URL is Pimlico', async () => {
    pimlicoPre.mockResolvedValue({ pimlico: true })

    const estimator = new BestEffortFeeEstimator('https://rpc.test', 'https://public.pimlico.io/v2/1/rpc')
    const result = await estimator.preEstimateUserOperationGas({} as never)

    expect(result).toEqual({ pimlico: true })
    expect(pimlicoPre).toHaveBeenCalledTimes(1)
    expect(genericPre).not.toHaveBeenCalled()
  })

  it('falls back to generic estimator when Pimlico estimator fails', async () => {
    pimlicoPre.mockRejectedValue(new Error('Pimlico down'))
    genericPre.mockResolvedValue({ generic: true })

    const estimator = new BestEffortFeeEstimator('https://rpc.test', 'https://public.pimlico.io/v2/1/rpc')
    const result = await estimator.preEstimateUserOperationGas({} as never)

    expect(result).toEqual({ generic: true })
    expect(pimlicoPre).toHaveBeenCalledTimes(1)
    expect(genericPre).toHaveBeenCalledTimes(1)
  })

  it('uses generic estimator for non-Pimlico bundlers', async () => {
    genericPre.mockResolvedValue({ generic: true })

    const estimator = new BestEffortFeeEstimator('https://rpc.test', 'https://bundler.example.com')
    const result = await estimator.preEstimateUserOperationGas({} as never)

    expect(result).toEqual({ generic: true })
    expect(pimlicoPre).not.toHaveBeenCalled()
    expect(genericPre).toHaveBeenCalledTimes(1)
  })
})

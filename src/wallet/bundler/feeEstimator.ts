import {
  GenericFeeEstimator,
  PimlicoFeeEstimator,
  type EstimateFeeFunctionProps,
  type IFeeEstimator,
} from '@safe-global/relay-kit'

const looksLikePimlico = (bundlerUrl: string) =>
  bundlerUrl.toLowerCase().includes('pimlico')

export class BestEffortFeeEstimator implements IFeeEstimator {
  private readonly generic: GenericFeeEstimator
  private readonly pimlico?: PimlicoFeeEstimator
  private readonly usePimlico: boolean

  constructor(rpcUrl: string, bundlerUrl: string) {
    this.generic = new GenericFeeEstimator(rpcUrl)
    this.usePimlico = looksLikePimlico(bundlerUrl)
    this.pimlico = this.usePimlico ? new PimlicoFeeEstimator() : undefined
  }

  async preEstimateUserOperationGas(props: EstimateFeeFunctionProps) {
    if (this.pimlico) {
      try {
        return await this.pimlico.preEstimateUserOperationGas(props)
      } catch {
        // Fall back to generic estimator when bundler-specific methods are unavailable.
      }
    }

    return this.generic.preEstimateUserOperationGas?.(props) ?? {}
  }

  async postEstimateUserOperationGas(props: EstimateFeeFunctionProps) {
    if (this.pimlico) {
      try {
        return await this.pimlico.postEstimateUserOperationGas(props)
      } catch {
        // Fall back to generic estimator when bundler-specific methods are unavailable.
      }
    }

    return this.generic.postEstimateUserOperationGas?.(props) ?? {}
  }
}

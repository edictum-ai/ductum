import { computeMeasuredCost, type ModelPricing } from './model-pricing.js'

export type CostTruthState = 'measured' | 'unpriced' | 'unmeasured'

export interface CostTruth {
  costUsd: number
  state: CostTruthState
}

export function resolveUsageCostTruth(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  override?: ModelPricing | null,
): CostTruth {
  const measured = computeMeasuredCost(model, tokensIn, tokensOut, override)
  return measured.measured
    ? { costUsd: measured.usd, state: 'measured' }
    : { costUsd: 0, state: measured.reason }
}

export function resolveRecordedCostTruth(input: {
  model: string | null | undefined
  tokensIn: number
  tokensOut: number
  costUsd: number
}): CostTruth {
  if (input.costUsd > 0) return { costUsd: input.costUsd, state: 'measured' }
  return resolveUsageCostTruth(input.model, input.tokensIn, input.tokensOut)
}

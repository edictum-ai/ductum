export type BestOfNPolicy = 'quality-gated-cost-aware' | 'cheapest-verified-reviewed'

export interface BestOfNSpecStrategyConfig {
  kind: 'best_of_n'
  policy: BestOfNPolicy
  strategyGroup: string
  builderAgentIds: string[]
  reviewerAgentId: string
  verify: string[]
}

export type SpecStrategyConfig = BestOfNSpecStrategyConfig

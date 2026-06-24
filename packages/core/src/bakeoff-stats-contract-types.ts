import type { CostTruthState } from './cost-truth.js'

export type BakeoffFailureCategory =
  | 'verification_failure'
  | 'review_failure'
  | 'implementation_failure'
  | 'malformed'
  | 'blocked'
  | 'missing_artifacts'
  | 'unknown'

export interface BakeoffStats {
  totals: BakeoffStatsRow
  perModel: BakeoffStatsRow[]
  perJudge: BakeoffStatsRow[]
}

export interface BakeoffStatsRow {
  key: string
  role: 'builder' | 'judge' | 'total'
  agentId: string | null
  agentName: string | null
  model: string
  modelLabel: string | null
  provider: string | null
  harness: string
  costUsd: number
  costState: CostTruthState
  tokensIn: number
  tokensOut: number
  totalTokens: number
  elapsedSeconds: number | null
  attempts: number
  passed: boolean
  failed: boolean
  malformedCount: number
  malformedRate: number
  reviewPasses: number
  reviewFailures: number
  reviewPassRate: number
  judge: string | null
  winner: boolean
  humanOverride: boolean
  failureCategory: BakeoffFailureCategory | null
}

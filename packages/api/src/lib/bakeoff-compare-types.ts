import type { BestOfNPolicy, BestOfNVerdict, Run, Task } from '@ductum/core'

export type BakeoffOverallStatus = 'pending' | 'running' | 'ready_for_review' | 'reviewing' | 'complete' | 'failed'

export interface BakeoffCompareResponse {
  spec: { id: string; projectId: string; name: string; status: string }
  policy: BestOfNPolicy
  strategyGroup: string
  status: BakeoffOverallStatus
  candidates: BakeoffCandidateCompare[]
  reviewTask: BakeoffTaskRunSummary | null
  verdict: BestOfNVerdict | null
  winner: { taskId: string; runId: string | null; outcome: string | null; eligible: boolean } | null
  eligibility: { eligibleCount: number; blockedCount: number }
  malformed: { reviewCount: number; recoveryState: string | null }
  nextActions: string[]
}

export interface BakeoffCandidateCompare {
  task: BakeoffTaskRunSummary
  agent: BakeoffAgentDisplay | null
  metrics: BakeoffCandidateMetrics
  scores: BakeoffCandidateScores
  outcome: string | null
  verdictScore: BestOfNVerdict['scores'][number] | null
  winner: boolean
  eligibility: BakeoffCandidateEligibility
}

export interface BakeoffTaskRunSummary {
  taskId: string
  taskName: string
  taskStatus: Task['status']
  runIds: string[]
  latestRunId: string | null
  latestRunStage: Run['stage'] | null
  terminalState: Run['terminalState'] | null
  blockedReason: string | null
  failReason: string | null
  pendingApproval: boolean
  branch: string | null
  commitSha: string | null
  prUrl: string | null
  worktreePaths: string[] | null
}

export interface BakeoffAgentDisplay {
  id: string
  name: string
  model: string
  modelLabel: string | null
  provider: string | null
  harness: string
  effort: string | null
  costTier: number
}

export interface BakeoffCandidateMetrics {
  tokensIn: number
  tokensOut: number
  totalTokens: number
  costUsd: number
  elapsedSeconds: number | null
  startedAt: string | null
  updatedAt: string | null
  attempts: number
  reviewPasses: number
  fixRounds: number
  verificationFailures: number
}

export interface BakeoffCandidateScores {
  implementation: number
  review: number
  tests: number
  costEfficiency: number
  overall: number
  reviewerConfidence: number | null
}

export interface BakeoffCandidateEligibility {
  eligible: boolean
  gates: {
    implementationCompleted: boolean
    verifyPassed: boolean
    reviewPassed: boolean
    warnAccepted: boolean
    safetyBlocked: boolean
    artifactsAvailable: boolean
  }
  blockingReasons: string[]
}

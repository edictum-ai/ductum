import type {
  Decision,
  Evidence,
  GateEvaluation,
  Run,
  RunStageTransition,
  RunUpdate,
  Task,
} from '@ductum/core'

export interface AcceptedTaskRun {
  run: Run
  task: Task
}

export interface GateCheckResult {
  allowed: boolean
  stage?: string
  completedStages?: string[]
  pendingApproval?: unknown
}

export interface RunContext {
  task: Task
  run: Run | null
  history: RunStageTransition[]
  evidence: Evidence[]
  gateEvaluations: GateEvaluation[]
  progressUpdates: RunUpdate[]
  git: {
    branch: string | null
    commitSha: string | null
    prNumber: number | null
    prUrl: string | null
  } | null
}

export interface ApiErrorPayload {
  error: string
  details?: unknown
}

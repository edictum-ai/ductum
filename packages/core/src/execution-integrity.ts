import { isBakeoffCandidateTask } from './bakeoff.js'
import {
  findOutcome,
  hasBulkImportedRecordedEvidence,
  hasInvalidOutcome,
  hasProseSuccessSignal,
  hasReconciledCompletionLineage,
  hasStructuredCompletionEvidence,
  hasStructuredFinalEvidence,
} from './execution-integrity-evidence.js'
import { reconcileTaskExternalOutcomeLineage } from './execution-integrity-task-outcome.js'
import type { Evidence, Run, Spec, Task } from './types.js'

export { customPayloadHasSuccessSignal } from './execution-integrity-evidence.js'

export type ExecutionMode = 'orchestrated' | 'external' | 'recorded' | 'unknown' | 'inconsistent'

export type ExecutionIssueCode =
  | 'done_run_without_lineage_or_external_outcome'
  | 'done_task_without_lineage_or_external_outcome'
  | 'external_outcome_on_non_done_run'
  | 'final_evidence_on_non_done_run'
  | 'prose_success_signal_on_non_done_run'
  | 'invalid_external_outcome'
  | 'invalid_bakeoff_candidate_outcome'
  | 'linked_commit_without_lineage'
  | 'bakeoff_candidate_without_outcome'
  | 'runtime_cost_mismatch'

const EXTERNAL_OUTCOMES = ['done', 'fixed', 'superseded'] as const
const BAKEOFF_CANDIDATE_OUTCOMES = ['accepted', 'accepted-with-fixes', 'rejected', 'fixed', 'superseded'] as const
const TASK_PRIMARY_ISSUE_CODES = ['done_task_without_lineage_or_external_outcome', 'bakeoff_candidate_without_outcome'] as const

export type ExternalOutcome = (typeof EXTERNAL_OUTCOMES)[number]
export type BakeoffCandidateOutcome = (typeof BAKEOFF_CANDIDATE_OUTCOMES)[number]

export interface ExecutionIssue {
  code: ExecutionIssueCode
  message: string
}

export interface ExecutionIntegrity {
  mode: ExecutionMode
  issues: ExecutionIssue[]
  hasDuctumLineage: boolean
  hasExternalOutcome: boolean
  externalOutcome: string | null
  bakeoffOutcome: string | null
}

export function hasDuctumExecutionLineage(run: Pick<Run, 'sessionId' | 'worktreePaths' | 'commitSha'>): boolean {
  return nonBlank(run.sessionId) && hasWorktree(run) && nonBlank(run.commitSha)
}

export function hasDuctumExecutionStart(run: Pick<Run, 'sessionId' | 'worktreePaths'>): boolean {
  return nonBlank(run.sessionId) && hasWorktree(run)
}

export function findExternalOutcome(evidence: readonly Evidence[]): string | null {
  return findOutcome(evidence, 'external-outcome', isExternalOutcome)
}

export function findBakeoffCandidateOutcome(evidence: readonly Evidence[]): string | null {
  return findOutcome(evidence, 'bakeoff-candidate-outcome', isBakeoffCandidateOutcome)
}

export function isExternalOutcome(value: unknown): value is ExternalOutcome {
  return typeof value === 'string' && EXTERNAL_OUTCOMES.includes(value as ExternalOutcome)
}

export function isBakeoffCandidateOutcome(value: unknown): value is BakeoffCandidateOutcome {
  return typeof value === 'string' && BAKEOFF_CANDIDATE_OUTCOMES.includes(value as BakeoffCandidateOutcome)
}

export function isPrimaryTaskExecutionIssueCode(code: string): code is ExecutionIssueCode {
  return TASK_PRIMARY_ISSUE_CODES.includes(code as (typeof TASK_PRIMARY_ISSUE_CODES)[number])
}

export function evaluateRunExecutionIntegrity(
  run: Run,
  evidence: readonly Evidence[],
): ExecutionIntegrity {
  const hasDuctumStart = hasDuctumExecutionStart(run)
  const hasFinalEvidence = hasStructuredFinalEvidence(evidence)
  const hasCompletionEvidence = hasStructuredCompletionEvidence(evidence)
  const hasDuctumEvidenceLineage = hasDuctumStart && run.stage === 'done' && hasCompletionEvidence
  const hasReconciledLineage = run.stage === 'done' && hasReconciledCompletionLineage(evidence)
  const hasDuctumLineage = hasDuctumExecutionLineage(run) || hasDuctumEvidenceLineage || hasReconciledLineage
  const hasRecordedImportEvidence = run.stage === 'done' && hasBulkImportedRecordedEvidence(evidence)
  const externalOutcome = findExternalOutcome(evidence)
  const hasExternalOutcome = externalOutcome != null
  const hasInvalidExternalOutcome = hasInvalidOutcome(evidence, 'external-outcome', isExternalOutcome)
  const bakeoffOutcome = findBakeoffCandidateOutcome(evidence)
  const runtimeCostMismatch = findRuntimeCostMismatch(evidence)
  const hasInvalidBakeoffOutcome = hasInvalidOutcome(
    evidence,
    'bakeoff-candidate-outcome',
    isBakeoffCandidateOutcome,
  )
  const issues: ExecutionIssue[] = []

  if (hasInvalidExternalOutcome) {
    issues.push({
      code: 'invalid_external_outcome',
      message: `external outcome must be one of: ${EXTERNAL_OUTCOMES.join(', ')}`,
    })
  }
  if (hasInvalidBakeoffOutcome) {
    issues.push({
      code: 'invalid_bakeoff_candidate_outcome',
      message: `bakeoff candidate outcome must be one of: ${BAKEOFF_CANDIDATE_OUTCOMES.join(', ')}`,
    })
  }
  if (runtimeCostMismatch != null) issues.push(runtimeCostMismatch)
  if (hasExternalOutcome && run.stage !== 'done') {
    issues.push({
      code: 'external_outcome_on_non_done_run',
      message: 'external outcome evidence is only valid after the run is done',
    })
  }
  if (hasFinalEvidence && run.stage !== 'done') {
    issues.push({
      code: 'final_evidence_on_non_done_run',
      message: 'run has structured final verification/review evidence but is not done',
    })
  }
  if (hasProseSuccessSignal(evidence) && run.stage !== 'done') {
    issues.push({
      code: 'prose_success_signal_on_non_done_run',
      message: 'run has success-looking prose evidence but is not done; prose is not success evidence',
    })
  }
  const doneMissingLineage = run.stage === 'done' && !hasDuctumLineage && !hasExternalOutcome && !hasRecordedImportEvidence
  if (doneMissingLineage) {
    issues.push({
      code: 'done_run_without_lineage_or_external_outcome',
      message: 'done run has no Ductum session/worktree/commit lineage and no explicit external outcome',
    })
  }
  if (!doneMissingLineage && nonBlank(run.commitSha) && !hasDuctumLineage && !hasExternalOutcome && !hasRecordedImportEvidence) {
    issues.push({
      code: 'linked_commit_without_lineage',
      message: 'run has a linked commit but no Ductum execution lineage or explicit external outcome',
    })
  }

  return {
    mode: resolveMode({
      issues,
      hasDuctumLineage,
      hasDuctumStart,
      hasExternalOutcome,
      hasRecordedSignal:
        run.stage === 'done' ||
        run.terminalState != null ||
        nonBlank(run.commitSha) ||
        hasCompletionEvidence,
    }),
    issues,
    hasDuctumLineage,
    hasExternalOutcome,
    externalOutcome,
    bakeoffOutcome,
  }
}

export function evaluateTaskExecutionIntegrity(
  task: Task,
  spec: Pick<Spec, 'strategy'> | null | undefined,
  runs: readonly Run[],
  evidenceByRunId: ReadonlyMap<Run['id'], readonly Evidence[]>,
): ExecutionIntegrity {
  const runIntegrities = reconcileTaskExternalOutcomeLineage(
    runs,
    runs.map((run) => evaluateRunExecutionIntegrity(run, evidenceByRunId.get(run.id) ?? [])),
    evidenceByRunId,
  )
  const hasDuctumLineage = runIntegrities.some((item) => item.hasDuctumLineage)
  const hasDuctumStart = runIntegrities.some((item) => item.mode === 'orchestrated')
  const externalOutcome = runIntegrities.find((item, index) => runs[index]?.stage === 'done' && item.externalOutcome != null)?.externalOutcome ?? null
  const bakeoffOutcome = runIntegrities.find((item) => item.bakeoffOutcome != null)?.bakeoffOutcome ?? null
  const hasExternalOutcome = externalOutcome != null
  const issues = runIntegrities.flatMap((item) => item.issues)

  if (task.status === 'done' && !hasDuctumLineage && !hasExternalOutcome) {
    issues.push({
      code: 'done_task_without_lineage_or_external_outcome',
      message: 'done task has no Ductum run with session/worktree/commit lineage and no explicit external outcome',
    })
  }
  if (isBakeoffCandidateTask(spec, task) && ['done', 'failed'].includes(task.status) && bakeoffOutcome == null) {
    issues.push({
      code: 'bakeoff_candidate_without_outcome',
      message: 'bakeoff candidate has no explicit accept/reject/fix outcome',
    })
  }

  return {
    mode: resolveMode({
      issues,
      hasDuctumLineage,
      hasDuctumStart,
      hasExternalOutcome,
      hasRecordedSignal: task.status === 'done' || runIntegrities.some((item) => item.mode === 'recorded'),
    }),
    issues,
    hasDuctumLineage,
    hasExternalOutcome,
    externalOutcome,
    bakeoffOutcome,
  }
}

function resolveMode(input: {
  issues: ExecutionIssue[]
  hasDuctumLineage: boolean
  hasDuctumStart: boolean
  hasExternalOutcome: boolean
  hasRecordedSignal: boolean
}): ExecutionMode {
  if (input.issues.length > 0) return 'inconsistent'
  if (input.hasExternalOutcome) return 'external'
  if (input.hasDuctumLineage) return 'orchestrated'
  if (input.hasDuctumStart) return 'orchestrated'
  if (input.hasRecordedSignal) return 'recorded'
  return 'unknown'
}

function hasWorktree(run: Pick<Run, 'worktreePaths'>): boolean {
  return run.worktreePaths?.some(nonBlank) === true
}

function nonBlank(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

function findRuntimeCostMismatch(evidence: readonly Evidence[]): ExecutionIssue | null {
  for (const item of evidence) {
    if (item.payload.kind !== 'attempt.runtime_accounting') continue
    const mismatch = item.payload.mismatch
    if (!isRecord(mismatch) || mismatch.kind !== 'db_runtime_cost') continue
    const runtime = numberValue(mismatch.runtimeReportedCostUsd)
    const stored = numberValue(mismatch.storedCostUsd)
    if (runtime == null || stored == null) return { code: 'runtime_cost_mismatch', message: 'runtime-reported attempt cost did not match stored attempt cost' }
    return { code: 'runtime_cost_mismatch', message: `runtime reported $${runtime.toFixed(4)} but stored $${stored.toFixed(4)}` }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

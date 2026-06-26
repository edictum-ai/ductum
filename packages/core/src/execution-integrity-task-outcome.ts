import type { Evidence, Run } from './types.js'

import { findExternalOutcome, type ExecutionIntegrity } from './execution-integrity.js'

export function reconcileTaskExternalOutcomeLineage(
  runs: readonly Run[],
  integrities: readonly ExecutionIntegrity[],
  evidenceByRunId: ReadonlyMap<Run['id'], readonly Evidence[]>,
): ExecutionIntegrity[] {
  const refs = collectTaskExternalOutcomeRefs(runs, evidenceByRunId)
  if (refs.length === 0) return [...integrities]
  return integrities.map((integrity, index) =>
    reconcileRunExternalOutcomeLineage(runs[index]!, integrity, refs))
}

interface TaskExternalOutcomeRef {
  runId: Run['id']
  branch: string | null
  commitSha: string | null
  prSource: string | null
}

function reconcileRunExternalOutcomeLineage(
  run: Run,
  integrity: ExecutionIntegrity,
  refs: readonly TaskExternalOutcomeRef[],
): ExecutionIntegrity {
  if (run.terminalState !== 'cancelled') return integrity
  if (!integrity.issues.some((issue) => issue.code === 'linked_commit_without_lineage')) return integrity
  if (!refs.some((ref) => ref.runId !== run.id && matchesTaskExternalOutcomeRef(run, ref))) return integrity
  const issues = integrity.issues.filter((issue) => issue.code !== 'linked_commit_without_lineage')
  return {
    ...integrity,
    issues,
    mode: resolveMode({
      issues,
      hasDuctumLineage: integrity.hasDuctumLineage,
      hasDuctumStart: hasDuctumExecutionStart(run),
      hasExternalOutcome: integrity.hasExternalOutcome,
      hasRecordedSignal: run.stage === 'done' || run.terminalState != null || nonBlank(run.commitSha),
    }),
  }
}

function collectTaskExternalOutcomeRefs(
  runs: readonly Run[],
  evidenceByRunId: ReadonlyMap<Run['id'], readonly Evidence[]>,
): TaskExternalOutcomeRef[] {
  return runs.flatMap((run) => {
    if (run.stage !== 'done') return []
    const evidence = evidenceByRunId.get(run.id) ?? []
    if (findExternalOutcome(evidence) == null) return []
    return [{
      runId: run.id,
      branch: blankToNull(run.branch),
      commitSha: blankToNull(run.commitSha),
      prSource: blankToNull(run.prUrl) ?? findExternalOutcomeSource(evidence),
    }]
  })
}

function matchesTaskExternalOutcomeRef(run: Run, ref: TaskExternalOutcomeRef): boolean {
  return (
    (nonBlank(run.commitSha) && ref.commitSha === run.commitSha) ||
    (nonBlank(run.branch) && ref.branch === run.branch) ||
    (nonBlank(run.prUrl) && ref.prSource === run.prUrl)
  )
}

function findExternalOutcomeSource(evidence: readonly Evidence[]): string | null {
  for (let index = evidence.length - 1; index >= 0; index -= 1) {
    const item = evidence[index]!
    if (item.type !== 'custom') continue
    if (item.payload.kind !== 'external-outcome') continue
    const sourcePath = typeof item.payload.sourcePath === 'string' ? blankToNull(item.payload.sourcePath) : null
    if (sourcePath != null) return sourcePath
  }
  return null
}

function resolveMode(input: {
  issues: ExecutionIntegrity['issues']
  hasDuctumLineage: boolean
  hasDuctumStart: boolean
  hasExternalOutcome: boolean
  hasRecordedSignal: boolean
}): ExecutionIntegrity['mode'] {
  if (input.issues.length > 0) return 'inconsistent'
  if (input.hasExternalOutcome) return 'external'
  if (input.hasDuctumLineage) return 'orchestrated'
  if (input.hasDuctumStart) return 'orchestrated'
  if (input.hasRecordedSignal) return 'recorded'
  return 'unknown'
}

function hasDuctumExecutionStart(run: Pick<Run, 'sessionId' | 'worktreePaths'>): boolean {
  return nonBlank(run.sessionId) && run.worktreePaths?.some(nonBlank) === true
}

function blankToNull(value: string | null | undefined): string | null {
  return nonBlank(value) ? value : null
}

function nonBlank(value: string | null | undefined): value is string {
  return value != null && value.trim() !== ''
}

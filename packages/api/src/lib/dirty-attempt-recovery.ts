import { existsSync } from 'node:fs'

import {
  groupRepairItems,
  buildDirtyPartialWorktreeEvidence,
  hasRelevantDirtyWorktree,
  inspectDirtyWorktrees,
  recordRef,
  repairItem,
  repairSummary,
  sortItems,
  type DirtyPartialWorktreeEvidence,
  type PrerequisiteIssue,
  type RepairReport,
  type Run,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'

const DIRTY_WORKTREE_ISSUE_CODE = 'dirty_partial_worktree'
const TERMINAL_STATES = new Set<NonNullable<Run['terminalState']>>([
  'failed',
  'stalled',
  'quarantined',
  'frozen',
  'cancelled',
  'paused',
])

export function appendDirtyAttemptRecoveryItems(report: RepairReport, context: ApiContext): RepairReport {
  const items = sortItems([
    ...report.items,
    ...buildDirtyAttemptRecoveryItems(context),
  ])
  if (items.length === report.items.length) return report
  return {
    ...report,
    items,
    groups: groupRepairItems(items),
    summary: repairSummary(items),
  }
}

export function buildDirtyAttemptRecoveryItems(context: ApiContext): PrerequisiteIssue[] {
  const factory = context.repos.factory.get()
  if (factory == null) return []
  const projects = context.repos.projects.list(factory.id)
  const specs = projects.flatMap((project) => context.repos.specs.list(project.id))
  const tasks = context.repos.tasks.listBySpecIds(specs.map((spec) => spec.id))
  const taskById = new Map(tasks.map((task) => [task.id, task] as const))
  const specById = new Map(specs.map((spec) => [spec.id, spec] as const))
  const projectById = new Map(projects.map((project) => [project.id, project] as const))
  return latestTerminalRuns(context).flatMap((run) => {
    const evidence = dirtyPartialWorktreeEvidence(context, run.id)
    if (evidence == null) return []
    if (isStaleDirtyPartialWorktreeEvidence(evidence.worktreePath)) return []
    const task = taskById.get(run.taskId)
    const spec = task == null ? null : (specById.get(task.specId) ?? null)
    const project = spec == null ? null : (projectById.get(spec.projectId) ?? null)
    if (task == null || spec == null || project == null) return []
    return [repairItem({
      id: `attempt:${run.id}:${DIRTY_WORKTREE_ISSUE_CODE}`,
      area: 'attempt_recovery',
      severity: 'attention',
      title: 'Attempt stopped with dirty partial worktree',
      reason: `Attempt ${run.id} stopped with preserved partial work in ${evidence.paths.join(', ')}.`,
      suggestedAction: buildDirtyWorktreeAction(evidence),
      record: recordRef('Attempt', run.id, task.name),
      field: {
        path: `attempts.${run.id}.worktree.paths`,
        label: 'Dirty worktree files',
        value: evidence.paths.join(', '),
      },
      status: 'unknown',
      issueCode: DIRTY_WORKTREE_ISSUE_CODE,
      target: {
        projectName: project.name,
        specId: spec.id,
        specName: spec.name,
        taskId: task.id,
        taskName: task.name,
        attemptId: run.id,
      },
      href: `/${encodeURIComponent(project.name)}/${encodeURIComponent(spec.name)}/${encodeURIComponent(task.name)}/${encodeURIComponent(run.id.slice(0, 6))}`,
      linkLabel: 'Open attempt',
    })]
  })
}

export async function assertRetrySafe(context: ApiContext, run: Run): Promise<void> {
  const snapshots = await inspectDirtyWorktrees(run.worktreePaths ?? [])
  // Stale preserved worktree paths are silently ignored by inspectDirtyWorktrees,
  // so a missing path never blocks retry -- the operator can re-dispatch when
  // the partial work cannot be saved. Only live, relevant dirty work blocks.
  if (!hasRelevantDirtyWorktree(snapshots)) return
  const snapshot = snapshots.find((entry) => entry.relevantPaths.length > 0) ?? snapshots[0]!
  const evidence = dirtyPartialWorktreeEvidence(context, run.id)
    ?? fallbackDirtyEvidence(run, snapshot)
  throw new ValidationError(
    `Retry blocked: Attempt ${run.id} still has preserved dirty worktree files (${evidence.paths.join(', ')}). ${buildDirtyWorktreeAction(evidence)}`,
  )
}

export function dirtyPartialWorktreeEvidence(
  context: ApiContext,
  runId: Run['id'],
): DirtyPartialWorktreeEvidence | null {
  for (const evidence of context.repos.evidence.list(runId)) {
    if (evidence.type !== 'custom' || evidence.payload.kind !== 'worktree.dirty_partial') continue
    return evidence.payload as DirtyPartialWorktreeEvidence
  }
  return null
}

/**
 * True when the preserved dirty-partial worktree path recorded for a run is
 * no longer on disk. Once the path is gone, no partial work can be
 * preserved, so repair must drop the stale blocker instead of surfacing it
 * to the operator. Retry is already unblocked by inspectDirtyWorktrees
 * silently ignoring missing paths.
 */
function isStaleDirtyPartialWorktreeEvidence(worktreePath: string | null): boolean {
  if (worktreePath == null || worktreePath.trim() === '') return true
  return !existsSync(worktreePath)
}

function latestTerminalRuns(context: ApiContext): Run[] {
  const latestByTask = new Map<Run['taskId'], Run>()
  for (const run of context.repos.runs.listAll({ limit: 10_000 })) {
    if (run.terminalState == null || !TERMINAL_STATES.has(run.terminalState)) continue
    const current = latestByTask.get(run.taskId)
    if (current == null || compareRunRecency(current, run) < 0) latestByTask.set(run.taskId, run)
  }
  return [...latestByTask.values()]
}

function fallbackDirtyEvidence(
  run: Run,
  snapshot: Awaited<ReturnType<typeof inspectDirtyWorktrees>>[number],
): DirtyPartialWorktreeEvidence {
  return buildDirtyPartialWorktreeEvidence(run, snapshot)
}

function buildDirtyWorktreeAction(evidence: DirtyPartialWorktreeEvidence): string {
  return [
    `Inspect with \`${evidence.recovery.statusCommand}\` and \`${evidence.recovery.logsCommand}\`.`,
    evidence.recovery.resumeCommand == null
      ? 'No supported Ductum resume command exists for this terminal state.'
      : `Resume on the preserved worktree with \`${evidence.recovery.resumeCommand}\`.`,
    evidence.recovery.patchCommand == null
      ? 'Package the preserved branch or diff before cleanup.'
      : `Package a patch with \`${evidence.recovery.patchCommand}\`, or commit the preserved branch manually.`,
    'Retry remains blocked until the dirty worktree is cleaned up safely.',
    evidence.recovery.cleanupNote,
  ].join(' ')
}

function compareRunRecency(left: Run, right: Run): number {
  return (
    left.createdAt.localeCompare(right.createdAt)
    || left.updatedAt.localeCompare(right.updatedAt)
    || left.id.localeCompare(right.id)
  )
}

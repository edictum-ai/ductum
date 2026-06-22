import type { Run, Task } from './types.js'

/**
 * The single derived "what happens next" for a run (design/04 §6). Pure
 * function of durable run/task state — no logs, no in-memory maps. CLI status,
 * the dashboard inbox, the API operator brief, and notification routing all
 * read THIS instead of each re-deriving status logic.
 *
 * Total over every run shape: an unmapped shape is a CI failure
 * (what-to-do-next.test.ts fixture matrix), never a blank inbox row.
 */

export type NextActionKind =
  | 'active'
  | 'waiting-on-approval'
  | 'blocked'
  | 'retrying'
  | 'resumable'
  | 'stalled'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'frozen'
  | 'quarantined'
  | 'done'

export interface NextAction {
  kind: NextActionKind
  /** Durable, greppable reason — surfaces silent skips/halts without logs. */
  reason: string
  /** True when a human is genuinely required (design/04 §5 escalation contract). */
  needsOperator: boolean
}

export interface WhatToDoNextOptions {
  now?: Date
  /** True when the run has a resumable checkpoint (mirrors canResumeStalledRun:
   *  checkpoint at understand/implement with a worktree still on disk). Absent
   *  → conservative false: a stalled run reads as needs-operator, never wrongly
   *  'resumable'. The API can supply this from runCheckpointRepo; the CLI's
   *  read-only API snapshot cannot, by design. */
  hasResumableCheckpoint?: boolean
}

/** Kinds that pull a human in (the §5 four triggers + the failure/stall shapes). */
const OPERATOR_NEEDED: ReadonlySet<NextActionKind> = new Set([
  'waiting-on-approval',
  'stalled',
  'failed',
  'frozen',
  'quarantined',
])

export function whatToDoNext(run: Run, task: Task | null, options: WhatToDoNextOptions = {}): NextAction {
  const now = options.now ?? new Date()

  // Terminal states first (specific → general). Every TerminalState member is
  // handled, so falling past the switch means run.terminalState === null.
  switch (run.terminalState) {
    case 'quarantined':
      return { kind: 'quarantined', reason: run.failReason ?? 'retry budget exhausted on deterministic failure', needsOperator: true }
    case 'cancelled':
      return { kind: 'cancelled', reason: run.failReason ?? 'cancelled', needsOperator: false }
    case 'failed':
      return { kind: 'failed', reason: run.failReason ?? 'failed', needsOperator: true }
    case 'stalled':
      return options.hasResumableCheckpoint
        ? { kind: 'resumable', reason: 'stalled with a resumable checkpoint', needsOperator: false }
        : { kind: 'stalled', reason: run.failReason ?? 'stalled — no resumable checkpoint', needsOperator: true }
    case 'paused':
      return { kind: 'paused', reason: run.failReason ?? 'operator paused', needsOperator: false }
    case 'frozen':
      return { kind: 'frozen', reason: run.failReason ?? 'system halt awaiting operator', needsOperator: true }
  }

  // Non-terminal.
  if (run.stage === 'done') {
    return { kind: 'done', reason: 'completed', needsOperator: false }
  }
  if (run.stage === 'ship' && run.pendingApproval) {
    return { kind: 'waiting-on-approval', reason: run.blockedReason ?? 'waiting for operator approval', needsOperator: true }
  }
  if (task != null && task.retryAfter != null && new Date(task.retryAfter).getTime() > now.getTime()) {
    return { kind: 'retrying', reason: `retry ${task.retryCount} scheduled, waiting on backoff until ${task.retryAfter}`, needsOperator: false }
  }
  if (run.blockedReason != null) {
    return { kind: 'blocked', reason: run.blockedReason, needsOperator: false }
  }
  return { kind: 'active', reason: `running at stage ${run.stage}`, needsOperator: false }
}

export function isNextActionOperatorNeeded(kind: NextActionKind): boolean {
  return OPERATOR_NEEDED.has(kind)
}

import type { Run, RunUiContract, Spec, Task } from '@/api/client'

/**
 * User-facing display status for a run. Mirrors @ductum/core's DisplayStatus /
 * the API RunUiStatusKey wire type so the dashboard does NOT fork semantics
 * from Edictum workflow semantics or from the API contract.
 *
 * Must stay in lockstep with `deriveDisplayStatus` in @ductum/core's
 * `run-display.ts`. paused/frozen/quarantined were added alongside the
 * quarantine terminal state (design/04 §5) — they are display-only derivations
 * over Run fields, never round-tripped through the workflow enum.
 */
export type DisplayStatus =
  | 'running'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'failed'
  | 'stalled'
  | 'cancelled'
  | 'paused'
  | 'frozen'
  | 'quarantined'
  | 'done'

/** Display statuses that pull an operator in (the §5 escalation set). Shared
 *  so run-presentation.ts and any fallback path agree with the API contract. */
export const NEEDS_OPERATOR_DISPLAY_STATUSES: ReadonlySet<DisplayStatus> = new Set([
  'failed',
  'stalled',
  'frozen',
  'quarantined',
])

/**
 * Compute the display status for a run. Delegates the terminal-state ladder to
 * the same precedence as @ductum/core's deriveDisplayStatus (quarantined →
 * failed → stalled → frozen → paused → cancelled → done → approval → running).
 * Heartbeat age is NOT considered here — the dispatcher owns the transition to
 * stalled.
 */
export function deriveDisplayStatus(run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'>): DisplayStatus {
  if (run.terminalState === 'quarantined') return 'quarantined'
  if (run.terminalState === 'failed') return 'failed'
  if (run.terminalState === 'stalled') return 'stalled'
  if (run.terminalState === 'frozen') return 'frozen'
  if (run.terminalState === 'paused') return 'paused'
  if (run.terminalState === 'cancelled') return 'cancelled'
  if (run.stage === 'done') return 'done'
  if (run.stage === 'ship' && run.pendingApproval) return 'awaiting_approval'
  return 'running'
}

export function isAwaitingApproval(
  run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: { status?: { key?: DisplayStatus } } },
): boolean {
  return displayStatusOf(run) === 'awaiting_approval'
}

/** Human-readable label for each DisplayStatus. */
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  running: 'Running',
  awaiting_review: 'Awaiting review',
  awaiting_approval: 'Awaiting approval',
  failed: 'Failed',
  stalled: 'Stalled',
  cancelled: 'Cancelled',
  paused: 'Paused',
  frozen: 'Frozen',
  quarantined: 'Quarantined',
  done: 'Done',
}

/** Tailwind classes for the DisplayStatus badge (light + dark themes). */
export const DISPLAY_STATUS_CLASSES: Record<DisplayStatus, string> = {
  running:
    'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/40',
  awaiting_review:
    'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800/40',
  awaiting_approval:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/40',
  failed:
    'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800/40',
  stalled:
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
  cancelled:
    'bg-zinc-100 text-zinc-800 border-zinc-200 dark:bg-zinc-950/60 dark:text-zinc-300 dark:border-zinc-800/40',
  paused:
    'bg-zinc-100 text-zinc-800 border-zinc-200 dark:bg-zinc-950/60 dark:text-zinc-300 dark:border-zinc-800/40',
  frozen:
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800/40',
  quarantined:
    'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-700/50',
  done:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/40',
}

/** Count runs by display status. */
export function countByDisplayStatus(
  runs: readonly (Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: { status?: { key?: DisplayStatus } } })[],
): Record<DisplayStatus, number> {
  const counts: Record<DisplayStatus, number> = {
    running: 0,
    awaiting_review: 0,
    awaiting_approval: 0,
    failed: 0,
    stalled: 0,
    cancelled: 0,
    paused: 0,
    frozen: 0,
    quarantined: 0,
    done: 0,
  }
  for (const run of runs) counts[displayStatusOf(run)] += 1
  return counts
}

/** Derive a spec's real status from its tasks rather than trusting the stored value. */
type DisplayStatusRun = Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> & {
  ui?: Pick<RunUiContract, 'status'>
}

export function deriveSpecStatus(spec: Spec, tasks: Task[], runs: DisplayStatusRun[]): string {
  if (tasks.length === 0) return spec.status

  const hasActive = tasks.some((t) => t.status === 'active' || t.status === 'in-progress')
  const allDone = tasks.every((t) => t.status === 'done')
  const hasFailed = runs.some((r) => {
    const status = displayStatusOf(r)
    return NEEDS_OPERATOR_DISPLAY_STATUSES.has(status)
  })
  const hasRunning = runs.some((r) => displayStatusOf(r) === 'running')

  if (allDone) return 'done'
  if (hasRunning || hasActive) return 'implementing'
  if (hasFailed) return 'implementing' // still has work to do
  if (spec.status === 'approved' || tasks.some((t) => t.status === 'ready')) return 'approved'
  return spec.status
}

/** Summarize task progress as "3/5 done" style string. */
export function taskProgress(tasks: Task[]): { done: number; total: number; text: string } {
  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  return { done, total, text: `${done}/${total}` }
}

function displayStatusOf(
  run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'> & { ui?: { status?: { key?: DisplayStatus } } },
): DisplayStatus {
  return run.ui?.status?.key ?? deriveDisplayStatus(run)
}

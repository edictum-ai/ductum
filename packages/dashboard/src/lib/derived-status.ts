import type { Run, Spec, Task } from '@/api/client'

/**
 * User-facing display status for a run. Derived from existing Run fields
 * (stage, terminalState, pendingApproval) so the dashboard does NOT fork
 * dashboard semantics from Edictum workflow semantics.
 *
 * Must stay in lockstep with `deriveDisplayStatus` in @ductum/core's
 * `run-display.ts` — both exist so dashboard and CLI can render the
 * same truth without a core dependency shift.
 */
export type DisplayStatus =
  | 'running'
  | 'awaiting_review'
  | 'awaiting_approval'
  | 'failed'
  | 'stalled'
  | 'cancelled'
  | 'done'

/**
 * Compute the display status for a run.
 *
 * Precedence: failed → stalled → cancelled → done → actionable approval → running.
 * Heartbeat age is NOT considered here — the dispatcher owns the
 * transition to stalled (see docs/analysis/2026-04-06 §P0/§P1).
 */
export function deriveDisplayStatus(run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'>): DisplayStatus {
  if (run.terminalState === 'failed') return 'failed'
  if (run.terminalState === 'stalled') return 'stalled'
  if (run.terminalState === 'cancelled') return 'cancelled'
  if (run.stage === 'failed') return 'failed'
  if (run.stage === 'stalled') return 'stalled'
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
    done: 0,
  }
  for (const run of runs) counts[displayStatusOf(run)] += 1
  return counts
}

/** Derive a spec's real status from its tasks rather than trusting the stored value. */
export function deriveSpecStatus(spec: Spec, tasks: Task[], runs: (Run & { ui?: { status?: { key?: DisplayStatus } } })[]): string {
  if (tasks.length === 0) return spec.status

  const hasActive = tasks.some((t) => t.status === 'active' || t.status === 'in-progress')
  const allDone = tasks.every((t) => t.status === 'done')
  const hasFailed = runs.some((r) => {
    const status = displayStatusOf(r)
    return status === 'failed' || status === 'stalled'
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

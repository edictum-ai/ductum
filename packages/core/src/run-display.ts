/**
 * Derived display status for runs.
 *
 * The Ductum runtime (via @edictum/core) only models a small set of
 * workflow stages and a terminal state. Dashboards, CLIs, and the
 * approval queue need a richer vocabulary — "awaiting approval" is a
 * real user-facing state, not a workflow stage. Instead of forking the
 * core workflow enum (which would leak dashboard semantics into Edictum
 * runtime semantics), we compute the display status from the existing
 * fields on a Run record.
 *
 * See docs/analysis/2026-04-06-factory-runtime-analysis.md §P1 for the
 * design rationale and the explicit "do not add awaiting_approval to
 * WorkflowStage" ruling from the Codex review.
 */

import type { Run } from './types.js'

/**
 * User-facing display buckets. Do NOT add values here that would need
 * to be round-tripped through the workflow enum — prefer derivation.
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
 * Compute the display status for a run from its existing fields.
 *
 * Precedence (specific → general):
 *   1. terminalState === 'failed'  → failed
 *   2. terminalState === 'stalled' → stalled
 *   3. terminalState === 'cancelled' → cancelled
 *   4. stage === 'done'            → done
 *   5. ship + pendingApproval      → awaiting_approval
 *   6. otherwise                   → running
 *
 * Heartbeat-aged runs that haven't been marked terminal by the
 * dispatcher are still "running" — the dispatcher owns the transition
 * to stalled. Callers MUST NOT re-derive "stalled" from heartbeat age
 * on their own; that's what caused the lifecycle-truth bug in the
 * first place.
 */
export function deriveDisplayStatus(run: Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'>): DisplayStatus {
  if (run.terminalState === 'failed') return 'failed'
  if (run.terminalState === 'stalled') return 'stalled'
  if (run.terminalState === 'cancelled') return 'cancelled'
  if (run.stage === 'done') return 'done'
  if (run.stage === 'ship' && run.pendingApproval) return 'awaiting_approval'
  return 'running'
}

/**
 * Human label for each display status — single source of truth so the
 * dashboard, CLI, and any future surfaces stay aligned.
 */
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  running: 'Running',
  awaiting_review: 'Awaiting review',
  awaiting_approval: 'Awaiting approval',
  failed: 'Failed',
  stalled: 'Stalled',
  cancelled: 'Cancelled',
  done: 'Done',
}

/**
 * Count runs by display status. Used by the dashboard homepage cards
 * and the CLI `ductum status` summary.
 */
export function countByDisplayStatus(
  runs: readonly Pick<Run, 'stage' | 'terminalState' | 'pendingApproval'>[],
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
  for (const run of runs) counts[deriveDisplayStatus(run)] += 1
  return counts
}

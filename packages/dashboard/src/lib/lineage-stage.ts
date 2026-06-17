/**
 * Lineage stage progression — derive a single "where is this lineage
 * right now" stage from the runs that exist for an impl + its review/
 * fix follow-ups.
 *
 * The Edictum WorkflowStage type only has 4 values:
 *   understand → implement → ship → done
 * but at the LINEAGE level we want to expose 5 visible phases for the
 * operator (the review phase is implicit in the SDK because review
 * runs are their own runs at understand→implement→done):
 *
 *   understand → implement → review → ship → done
 *
 * We compute the lineage stage by walking every run in the lineage
 * (impl + reviews + fixes) and picking the FURTHEST progression any
 * non-terminal run has reached. Once a run lands at `done` we lock
 * the lineage to `done`. If every run is failed/stalled and none are
 * done, we mark the lineage `failed`.
 */

import type { EnrichedRun } from '@/api/client'

import { parseTaskKind, type TaskKind } from './task-kind'

export type LineageStage =
  | 'understand'
  | 'implement'
  | 'review'
  | 'ship'
  | 'done'
  | 'failed'

export const LINEAGE_STAGE_ORDER: LineageStage[] = [
  'understand',
  'implement',
  'review',
  'ship',
  'done',
]

export const LINEAGE_STAGE_LABEL: Record<LineageStage, string> = {
  understand: 'understand',
  implement: 'implement',
  review: 'review',
  ship: 'ship',
  done: 'done',
  failed: 'failed',
}

/**
 * Map a run's WorkflowStage onto its lineage-level position. Review
 * and fix tasks effectively run in the "review" phase of the
 * lineage; impl tasks pass through understand/implement/ship/done
 * directly. The kind is needed because a review run with stage='ship'
 * still represents the lineage being in the "review" phase, not the
 * impl run shipping.
 */
function runLineagePosition(run: EnrichedRun, kind: TaskKind): number {
  if (run.terminalState != null) return -1 // terminal runs don't pin a phase
  // Map raw stage → numeric index in LINEAGE_STAGE_ORDER.
  if (kind === 'impl') {
    if (run.stage === 'understand') return 0
    if (run.stage === 'implement') return 1
    if (run.stage === 'ship') return 3
    if (run.stage === 'done') return 4
    return 1
  }
  // Review or fix run: as long as it exists and isn't terminal, the
  // lineage is in the "review" phase. Whether the underlying run is
  // at understand or implement is the role's internal detail.
  if (run.stage === 'done') return 4
  return 2
}

/**
 * Compute the effective lineage stage from the union of runs across
 * the impl + review + fix tasks for one lineage.
 *
 * Rules (in priority order):
 *   1. If any run reached `done` (the lineage shipped), return `done`.
 *   2. Else if any non-terminal run is at the highest position so
 *      far seen, return that stage.
 *   3. Else if every run is terminal-failed, return `failed`.
 *   4. Else default to `understand`.
 */
export function computeLineageStage(runs: EnrichedRun[]): LineageStage {
  if (runs.length === 0) return 'understand'

  let maxPosition = -1
  let anyDone = false
  let allTerminal = true

  for (const run of runs) {
    const kind = parseTaskKind(run.taskName).kind
    if (run.stage === 'done' && run.terminalState == null) {
      anyDone = true
      allTerminal = false
      if (4 > maxPosition) maxPosition = 4
      continue
    }
    if (run.terminalState != null) continue
    allTerminal = false
    const pos = runLineagePosition(run, kind)
    if (pos > maxPosition) maxPosition = pos
  }

  if (anyDone) return 'done'
  if (allTerminal && maxPosition < 0) return 'failed'
  if (maxPosition < 0) return 'understand'
  return LINEAGE_STAGE_ORDER[maxPosition] ?? 'understand'
}

/**
 * Pick a tailwind class for the segment fill. Done segments fill
 * green; the active segment fills blue; future segments stay grey;
 * the entire bar turns red when the lineage failed.
 */
export function lineageSegmentClass(
  segment: LineageStage,
  current: LineageStage,
): string {
  if (current === 'failed') return 'bg-red-500/50'
  if (current === 'done') return 'bg-emerald-500/60'
  const segmentIdx = LINEAGE_STAGE_ORDER.indexOf(segment)
  const currentIdx = LINEAGE_STAGE_ORDER.indexOf(current)
  if (segmentIdx < 0 || currentIdx < 0) return 'bg-muted/30'
  if (segmentIdx < currentIdx) return 'bg-emerald-500/60'
  if (segmentIdx === currentIdx) return 'bg-blue-500/70'
  return 'bg-muted/30'
}

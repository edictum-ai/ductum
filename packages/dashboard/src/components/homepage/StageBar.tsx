import {
  computeLineageStage,
  LINEAGE_STAGE_LABEL,
  LINEAGE_STAGE_ORDER,
  lineageSegmentClass,
  type LineageStage,
} from '@/lib/lineage-stage'
import type { EnrichedRun } from '@/api/client'
import { cn } from '@/lib/utils'

/**
 * Five-segment lineage stage progression bar:
 *   [understand][implement][review][ship][done]
 *
 * Done segments fill green, the active segment fills blue, future
 * segments stay grey. Failed lineages turn the whole bar red.
 *
 * The bar is purely derived from the runs in the lineage — no extra
 * fetching needed. Designed to slot under the lineage row title in
 * SpecGroups (homepage) and SpecCommandCenter (spec page) so the
 * operator can scan a column of lineages and see exactly where each
 * one is stuck without reading the row.
 */
export function StageBar({
  runs,
  compact = false,
  showLabel = false,
}: {
  runs: EnrichedRun[]
  /** Smaller bar for inline use inside dense lineage rows. */
  compact?: boolean
  /** Show the current stage name to the right of the bar. */
  showLabel?: boolean
}) {
  const stage = computeLineageStage(runs)
  return (
    <div className={cn('flex items-center gap-2', compact ? 'text-[8px]' : 'text-[9px]')}>
      <div className="flex flex-1 gap-px overflow-hidden rounded-sm">
        {LINEAGE_STAGE_ORDER.map((seg) => (
          <Segment key={seg} segment={seg} current={stage} compact={compact} />
        ))}
      </div>
      {showLabel && (
        <span
          className={cn(
            'shrink-0 font-mono uppercase tracking-wider',
            stage === 'failed'
              ? 'text-red-300'
              : stage === 'done'
                ? 'text-emerald-300'
                : 'text-blue-300',
          )}
        >
          {LINEAGE_STAGE_LABEL[stage]}
        </span>
      )}
    </div>
  )
}

function Segment({
  segment,
  current,
  compact,
}: {
  segment: LineageStage
  current: LineageStage
  compact: boolean
}) {
  const fill = lineageSegmentClass(segment, current)
  return (
    <div
      className={cn(
        'flex-1 transition-colors',
        compact ? 'h-1' : 'h-1.5',
        fill,
      )}
      title={LINEAGE_STAGE_LABEL[segment]}
    />
  )
}

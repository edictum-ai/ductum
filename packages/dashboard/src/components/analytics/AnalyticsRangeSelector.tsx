import type { AnalyticsRangeKind } from '@/api/client'
import { tokens } from '@/components/signal'

const RANGE_OPTIONS: ReadonlyArray<{ kind: AnalyticsRangeKind; label: string; short: string }> = [
  { kind: '7d', label: 'Last 7 days', short: '7d' },
  { kind: '30d', label: 'Last 30 days', short: '30d' },
  { kind: '90d', label: 'Last 90 days', short: '90d' },
  { kind: 'all', label: 'All attempts', short: 'All' },
]

/**
 * Date-range selector for analytics. Honored by every headline metric
 * on the page (issue #218). Defaults to 7d so the dashboard never
 * silently switches to "all attempts" when the operator changes tabs.
 */
export function AnalyticsRangeSelector({
  value,
  onChange,
  windowLabel,
}: {
  value: AnalyticsRangeKind
  onChange: (kind: AnalyticsRangeKind) => void
  windowLabel?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Analytics date range"
      style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 8, border: `1px solid ${tokens.hair}`, background: tokens.canvas }}
    >
      {RANGE_OPTIONS.map((option) => {
        const active = option.kind === value
        return (
          <button
            key={option.kind}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={windowLabel && active ? windowLabel : option.label}
            onClick={() => onChange(option.kind)}
            style={{
              border: '1px solid transparent',
              borderRadius: 6,
              padding: '6px 12px',
              background: active ? tokens.raised : 'transparent',
              color: active ? tokens.strong : tokens.mid,
              cursor: 'pointer',
              fontFamily: tokens.mono,
              fontSize: 11,
              fontWeight: active ? 600 : 400,
              letterSpacing: 0.4,
            }}
          >
            {option.short}
          </button>
        )
      })}
    </div>
  )
}

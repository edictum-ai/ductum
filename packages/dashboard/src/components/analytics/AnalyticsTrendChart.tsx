import type { AnalyticsBucket } from '@/api/client'
import { Mono, tokens } from '@/components/signal'

type TrendMetric = 'spendUsd' | 'attempts' | 'cleanDone' | 'cleanDoneRate' | 'stalls' | 'failures' | 'missingUsage'

const METRIC_LABELS: Record<TrendMetric, string> = {
  spendUsd: 'Spend (USD)',
  attempts: 'Attempts',
  cleanDone: 'Clean done',
  cleanDoneRate: 'Clean-done rate',
  stalls: 'Stalls',
  failures: 'Failures',
  missingUsage: 'Unmeasured',
}

const METRIC_COLORS: Record<TrendMetric, string> = {
  spendUsd: tokens.accent,
  attempts: tokens.info,
  cleanDone: tokens.ok,
  cleanDoneRate: tokens.ok,
  stalls: tokens.warn,
  failures: tokens.err,
  missingUsage: tokens.warn,
}

/**
 * Lightweight SVG trend chart (no external charting dependency, per
 * issue #218 out-of-scope: hosted BI stack). The chart renders the
 * selected metric per bucket; bars are colored by metric semantics.
 */
export function AnalyticsTrendChart({
  buckets,
  metric,
  ariaLabel,
}: {
  buckets: AnalyticsBucket[]
  metric: TrendMetric
  ariaLabel?: string
}) {
  const maxValue = Math.max(1, ...buckets.map((b) => readMetric(b, metric)))
  const width = 100 // viewBox width in arbitrary units
  const barGap = buckets.length > 1 ? 0.5 : 0
  const barWidth = buckets.length === 0 ? 0 : (width - barGap * (buckets.length - 1)) / buckets.length
  const lastNonZero = findLastNonZero(buckets, metric)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <Mono size={10} color={tokens.dim} style={{ letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {METRIC_LABELS[metric]}
        </Mono>
        <Mono size={11} color={tokens.strong}>
          {formatMetricValue(sumMetric(buckets, metric), metric)}
        </Mono>
      </div>
      {buckets.length === 0 ? (
        <p style={{ color: tokens.dim, fontSize: 12 }}>No attempts in this window.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} 24`}
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel ?? `${METRIC_LABELS[metric]} trend`}
          style={{ width: '100%', height: 64, display: 'block' }}
        >
          {buckets.map((bucket, index) => {
            const value = readMetric(bucket, metric)
            const height = (value / maxValue) * 22
            const x = index * (barWidth + barGap)
            const y = 24 - height
            const isLastNonZero = lastNonZero === index
            return (
              <g key={bucket.bucketLabel}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  fill={METRIC_COLORS[metric]}
                  opacity={value === 0 ? 0.15 : isLastNonZero ? 1 : 0.7}
                >
                  <title>{`${bucket.bucketLabel}: ${formatMetricValue(value, metric)}`}</title>
                </rect>
              </g>
            )
          })}
          <line x1={0} y1={24} x2={width} y2={24} stroke={tokens.hair} strokeWidth={0.3} />
        </svg>
      )}
      <Mono size={9} color={tokens.dim} style={{ marginTop: 6, display: 'block', lineHeight: 1.3 }}>
        {buckets.length > 0 ? `first: ${buckets[0]!.bucketLabel} · last: ${buckets.at(-1)!.bucketLabel}` : ''}
      </Mono>
    </div>
  )
}

function readMetric(bucket: AnalyticsBucket, metric: TrendMetric): number {
  if (metric === 'cleanDoneRate') return bucket.attempts === 0 ? 0 : (bucket.cleanDone / bucket.attempts) * 100
  return bucket[metric]
}

function sumMetric(buckets: AnalyticsBucket[], metric: TrendMetric): number {
  if (metric === 'cleanDoneRate') {
    const attempts = buckets.reduce((sum, b) => sum + b.attempts, 0)
    if (attempts === 0) return 0
    const cleanDone = buckets.reduce((sum, b) => sum + b.cleanDone, 0)
    return (cleanDone / attempts) * 100
  }
  return buckets.reduce((sum, b) => sum + readMetric(b, metric), 0)
}

function findLastNonZero(buckets: AnalyticsBucket[], metric: TrendMetric): number | null {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    if (readMetric(buckets[i]!, metric) > 0) return i
  }
  return null
}

function formatMetricValue(value: number, metric: TrendMetric): string {
  if (metric === 'spendUsd') {
    if (value <= 0) return '$0'
    if (value < 0.01) return '<$0.01'
    return `$${value.toFixed(2)}`
  }
  if (metric === 'cleanDoneRate') return `${Math.round(value)}%`
  return String(Math.round(value))
}

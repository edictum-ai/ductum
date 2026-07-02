import type { AnalyticsHeadline as AnalyticsHeadlineData, AnalyticsRangeWindow } from '@/api/client'
import { Mono, tokens } from '@/components/signal'

/**
 * Headline summary panel. Window label and coverage caveat render on
 * every metric so the operator always knows which date range and
 * which coverage gap (if any) the totals reflect.
 */
export function AnalyticsHeadline({
  headline,
  previous,
  window_,
}: {
  headline: AnalyticsHeadlineData
  previous: AnalyticsHeadlineData | null
  window_: AnalyticsRangeWindow
}) {
  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0, fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: tokens.dim }}>
          Headline · {window_.label}
        </h3>
        <Mono size={10} color={tokens.dim}>
          {formatRangeBounds(window_)}
        </Mono>
      </div>
      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Metric label="Attempts" value={String(headline.attemptCount)} delta={deltaLabel(headline.attemptCount, previous?.attemptCount)} />
        <Metric label="Clean done" value={headline.cleanDoneRateLabel} tone={headline.cleanDone === 0 ? tokens.dim : tokens.ok} delta={deltaLabel(headline.cleanDone, previous?.cleanDone)} />
        <Metric label="Cost / clean done" value={headline.costPerCleanDoneLabel} tone={headline.costPerCleanDoneUsd == null ? tokens.dim : tokens.strong} />
        <Metric label="Tracked spend" value={`$${headline.cost.trackedUsd.toFixed(2)}`} tone={headline.cost.trackedUsd > 0 ? tokens.strong : tokens.dim} delta={deltaLabel(headline.cost.trackedUsd, previous?.cost.trackedUsd, true)} />
        <Metric label="Stalled / failed" value={String(headline.stalledOrFailed)} tone={headline.stalledOrFailed > 0 ? tokens.warn : tokens.ok} delta={deltaLabel(headline.stalledOrFailed, previous?.stalledOrFailed)} />
        <Metric label="Missing usage" value={String(headline.cost.missingUsage)} tone={headline.cost.missingUsage > 0 ? tokens.warn : tokens.dim} />
        <Metric label="Missing price" value={String(headline.cost.missingPrice)} tone={headline.cost.missingPrice > 0 ? tokens.info : tokens.dim} />
        <Metric label="Verify failures" value={String(headline.verificationFailures)} tone={headline.verificationFailures > 0 ? tokens.err : tokens.dim} />
      </div>
      <CoverageCopy headline={headline} />
    </section>
  )
}

function Metric({
  label,
  value,
  tone,
  delta,
}: {
  label: string
  value: string
  tone?: string
  delta?: string
}) {
  return (
    <div style={{ padding: '10px 12px', border: `1px solid ${tokens.hair}`, borderRadius: 8, background: tokens.canvas }}>
      <Mono size={9.5} color={tokens.dim} style={{ letterSpacing: 1.4, textTransform: 'uppercase' }}>
        {label}
      </Mono>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 600, color: tone ?? tokens.strong, fontFamily: tokens.mono, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {delta && (
        <Mono size={10} color={tokens.dim} style={{ marginTop: 4, display: 'block' }}>
          {delta}
        </Mono>
      )}
    </div>
  )
}

function CoverageCopy({ headline }: { headline: AnalyticsHeadlineData }) {
  const cost = headline.cost
  return (
    <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${tokens.hair}`, borderRadius: 8, background: tokens.canvas }}>
      <Mono size={9.5} color={tokens.dim} style={{ letterSpacing: 1.4, textTransform: 'uppercase' }}>
        Coverage
      </Mono>
      <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 4 }}>
        <li>
          <Mono size={11} color={tokens.strong}>Known spend · </Mono>
          <Mono size={11} color={cost.trackedUsd > 0 ? tokens.ok : tokens.dim}>
            {cost.trackedUsd > 0 ? `$${cost.trackedUsd.toFixed(2)} across ${cost.measured} attempt${cost.measured === 1 ? '' : 's'}` : 'no tracked spend'}
          </Mono>
        </li>
        <li>
          <Mono size={11} color={tokens.strong}>Usage missing · </Mono>
          <Mono size={11} color={cost.missingUsage > 0 ? tokens.warn : tokens.dim}>
            {cost.missingUsage > 0 ? `${cost.missingUsage} attempt${cost.missingUsage === 1 ? ' has' : 's have'} no token data` : 'no attempts missing usage'}
          </Mono>
        </li>
        <li>
          <Mono size={11} color={tokens.strong}>Price missing · </Mono>
          <Mono size={11} color={cost.missingPrice > 0 ? tokens.info : tokens.dim}>
            {cost.missingPrice > 0 ? `${cost.missingPrice} attempt${cost.missingPrice === 1 ? '' : 's'} recorded tokens but no price` : 'no attempts missing price'}
          </Mono>
        </li>
      </ul>
    </div>
  )
}

function formatRangeBounds(window_: AnalyticsRangeWindow): string {
  if (window_.from == null) return `since first attempt · until ${window_.to.slice(0, 10)}`
  return `${window_.from.slice(0, 10)} → ${window_.to.slice(0, 10)}`
}

function deltaLabel(current: number, previous: number | undefined, isCurrency?: boolean): string | undefined {
  if (previous == null) return undefined
  const diff = current - previous
  if (diff === 0) return 'flat vs prior'
  const sign = diff > 0 ? '+' : '-'
  const magnitude = Math.abs(diff)
  if (isCurrency) return `${sign}$${magnitude.toFixed(2)} vs prior`
  return `${sign}${magnitude} vs prior`
}

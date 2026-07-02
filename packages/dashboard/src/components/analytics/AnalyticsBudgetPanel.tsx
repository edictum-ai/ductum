import type { AnalyticsBudgetBurndown } from '@/api/client'
import { Mono, tokens } from '@/components/signal'

/**
 * Budget burn-down panel. Renders cumulative spend over time against
 * the aggregate cap for active specs, with the per-spec cap shown in
 * each row. When no cap is configured, we still render spend so the
 * dashboard fails open with explicit copy instead of inventing a total.
 */
export function AnalyticsBudgetPanel({ budget }: { budget: AnalyticsBudgetBurndown | null }) {
  if (budget == null) {
    return <p style={{ fontSize: 12, color: tokens.dim }}>Budget burn-down unavailable.</p>
  }
  const maxCumulative = Math.max(
    budget.capUsd ?? 0,
    ...budget.series.map((point) => point.cumulativeUsd),
    0.01,
  )
  const aggregateCapUsd = budget.capUsd != null && budget.capUsd > 0 ? budget.capUsd : null
  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: tokens.dim }}>
            Budget burn-down · active specs
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: tokens.mid }}>
            <Mono size={11} color={tokens.strong}>${budget.spentUsd.toFixed(2)}</Mono>
            <span> tracked</span>
            {aggregateCapUsd != null && (
              <>
                <span> of </span>
                <Mono size={11} color={tokens.strong}>${aggregateCapUsd.toFixed(2)}</Mono>
                <span> cap</span>
              </>
            )}
            {aggregateCapUsd != null && budget.remainingUsd != null && (
              <Mono size={10} color={tokens.dim}> · ${budget.remainingUsd.toFixed(2)} remaining</Mono>
            )}
          </p>
        </div>
        <Mono size={10} color={tokens.dim}>{budget.burnPctLabel}</Mono>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
        <CumulativeSeries budget={budget} maxCumulative={maxCumulative} />
        <SpecTable budget={budget} />
      </div>
    </section>
  )
}

function CumulativeSeries({
  budget,
  maxCumulative,
}: {
  budget: AnalyticsBudgetBurndown
  maxCumulative: number
}) {
  if (budget.series.length === 0) {
    return <p style={{ fontSize: 12, color: tokens.dim }}>No tracked spend in this window yet.</p>
  }
  const width = 100
  const barWidth = budget.series.length === 0 ? 0 : width / budget.series.length
  const capY = budget.capUsd == null || budget.capUsd <= 0 ? null : 32 - (budget.capUsd / maxCumulative) * 30
  return (
    <svg
      viewBox={`0 0 ${width} 32`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Cumulative spend vs budget cap"
      style={{ width: '100%', height: 96 }}
    >
      {budget.series.map((point, index) => {
        const height = (point.cumulativeUsd / maxCumulative) * 30
        const x = index * barWidth
        const y = 32 - height
        return (
          <g key={point.day}>
            <rect
              x={x + 0.4}
              y={y}
              width={Math.max(0.6, barWidth - 0.8)}
              height={height}
              fill={tokens.accent}
              opacity={0.7}
            >
              <title>{`${point.day}: $${point.cumulativeUsd.toFixed(2)} cumulative (+$${point.spentUsd.toFixed(2)})`}</title>
            </rect>
          </g>
        )
      })}
      {capY != null && (
        <line x1={0} y1={capY} x2={width} y2={capY} stroke={tokens.err} strokeWidth={0.4} strokeDasharray="2 1.4">
          <title>{`cap $${budget.capUsd?.toFixed(2)}`}</title>
        </line>
      )}
    </svg>
  )
}

function SpecTable({ budget }: { budget: AnalyticsBudgetBurndown }) {
  if (budget.bySpec.length === 0) {
    return <p style={{ fontSize: 12, color: tokens.dim }}>No spec spend in this window.</p>
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr>
          <Th>Spec</Th>
          <Th>Project</Th>
          <Th align="right">Attempts</Th>
          <Th align="right">Spent</Th>
          <Th align="right">Remaining</Th>
          <Th align="right">Burn</Th>
        </tr>
      </thead>
      <tbody>
        {budget.bySpec.map((row) => (
          <tr key={row.specId} style={{ borderTop: `1px solid ${tokens.hair}` }}>
            <Td>{row.specName}</Td>
            <Td><Mono size={11} color={tokens.dim}>{row.projectName}</Mono></Td>
            <Td align="right" mono>{row.attemptCount}</Td>
            <Td align="right" mono>${row.spentUsd.toFixed(2)}</Td>
            <Td align="right" mono>
              {row.remainingUsd == null ? '—' : `$${row.remainingUsd.toFixed(2)}`}
            </Td>
            <Td align="right" mono tone={row.burnPct == null ? tokens.dim : row.burnPct >= 0.8 ? tokens.err : row.burnPct >= 0.5 ? tokens.warn : tokens.ok}>
              {row.burnPct == null ? 'no cap' : `${Math.round(row.burnPct * 100)}%`}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      style={{
        textAlign: align,
        padding: '8px 10px',
        fontFamily: tokens.mono,
        fontSize: 9.5,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        color: tokens.dim,
        fontWeight: 500,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  mono,
  tone,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
  tone?: string
}) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '8px 10px',
        fontFamily: mono ? tokens.mono : tokens.sans,
        color: tone ?? tokens.strong,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
      }}
    >
      {children}
    </td>
  )
}

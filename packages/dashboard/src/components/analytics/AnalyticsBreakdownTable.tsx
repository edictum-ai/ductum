import type { AnalyticsBreakdownRow } from '@/api/client'
import { Mono, tokens } from '@/components/signal'

/**
 * Per-agent / per-model breakdown table. Renders success rate, cost per
 * clean outcome, review pass/fail, and verification failures.
 *
 * The page passes either `'agent'` or `'model'` so the column header
 * reads correctly.
 */
export function AnalyticsBreakdownTable({
  rows,
  scope,
  emptyLabel,
}: {
  rows: AnalyticsBreakdownRow[]
  scope: 'agent' | 'model'
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p style={{ color: tokens.dim, fontSize: 12, padding: '8px 0' }}>{emptyLabel}</p>
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <Th>{scope === 'agent' ? 'Agent' : 'Model'}</Th>
            <Th align="right">Attempts</Th>
            <Th align="right">Clean done</Th>
            <Th align="right">Success rate</Th>
            <Th align="right">Cost / clean</Th>
            <Th align="right">Review pass/fail</Th>
            <Th align="right">Verify fails</Th>
            <Th align="right">Tracked spend</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderTop: `1px solid ${tokens.hair}` }}>
              <Td>
                <div style={{ fontWeight: 600 }}>{row.label}</div>
                {row.secondaryLabel && (
                  <Mono size={10} color={tokens.dim} style={{ marginTop: 2, display: 'block' }}>
                    {row.secondaryLabel}
                  </Mono>
                )}
              </Td>
              <Td align="right" mono>{row.attemptCount}</Td>
              <Td align="right" mono>{row.cleanDone}</Td>
              <Td align="right" mono tone={row.successRatePct == null ? tokens.dim : row.successRatePct >= 0.7 ? tokens.ok : tokens.warn}>
                {row.successRateLabel}
              </Td>
              <Td align="right" mono>{row.costPerCleanDoneLabel}</Td>
              <Td align="right" mono>
                <span style={{ color: tokens.ok }}>{row.reviewPasses}</span>
                <span style={{ color: tokens.dim }}> / </span>
                <span style={{ color: row.reviewFailures > 0 ? tokens.err : tokens.dim }}>{row.reviewFailures}</span>
              </Td>
              <Td align="right" mono tone={row.verificationFailures > 0 ? tokens.err : tokens.dim}>
                {row.verificationFailures}
              </Td>
              <Td align="right" mono tone={row.costTrackedUsd > 0 ? tokens.strong : tokens.dim}>
                {formatUsd(row.costTrackedUsd)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function formatUsd(usd: number): string {
  if (usd <= 0) return '—'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

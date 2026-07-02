import type {
  AnalyticsMissingUsageFilter,
  AnalyticsMissingUsageFilterKind,
} from '@/api/client'
import { Mono, tokens } from '@/components/signal'

const FILTER_OPTIONS: ReadonlyArray<{ kind: AnalyticsMissingUsageFilterKind; label: string; short: string }> = [
  { kind: 'any_gap', label: 'Any gap', short: 'Any gap' },
  { kind: 'usage_missing', label: 'Missing usage', short: 'Usage' },
  { kind: 'price_missing', label: 'Missing price', short: 'Price' },
]

/**
 * Missing-usage filter panel. The total count is server-authoritative;
 * the rows list is a capped sample with explicit "showing N of M"
 * copy so the dashboard never fakes a count from a truncated list.
 */
export function AnalyticsMissingUsagePanel({
  filter,
  onChange,
  windowLabel,
}: {
  filter: AnalyticsMissingUsageFilter
  onChange: (kind: AnalyticsMissingUsageFilterKind) => void
  windowLabel: string
}) {
  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: tokens.dim }}>
            Unmeasured attempts · {windowLabel}
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: tokens.mid }}>
            <Mono size={11} color={tokens.strong}>{filter.totalAttempts}</Mono>
            <span> attempt{filter.totalAttempts === 1 ? '' : 's'} in window</span>
            {filter.rowsCapped && (
              <Mono size={10} color={tokens.warn}> · showing first {filter.rowsCap}</Mono>
            )}
          </p>
        </div>
        <div role="radiogroup" aria-label="Missing-usage filter" style={{ display: 'inline-flex', gap: 4, padding: 4, borderRadius: 8, border: `1px solid ${tokens.hair}`, background: tokens.canvas }}>
          {FILTER_OPTIONS.map((option) => {
            const active = option.kind === filter.coverageKind
            return (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(option.kind)}
                style={{
                  border: '1px solid transparent',
                  borderRadius: 6,
                  padding: '4px 10px',
                  background: active ? tokens.raised : 'transparent',
                  color: active ? tokens.strong : tokens.mid,
                  cursor: 'pointer',
                  fontFamily: tokens.mono,
                  fontSize: 10.5,
                  fontWeight: active ? 600 : 400,
                }}
              >
                {option.short}
              </button>
            )
          })}
        </div>
      </div>
      {filter.rows.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 12, color: tokens.dim }}>No attempts match this filter in the selected window.</p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <Th>Task</Th>
                <Th>Project / spec</Th>
                <Th>Agent</Th>
                <Th>Stage</Th>
                <Th>Coverage</Th>
                <Th align="right">Created</Th>
              </tr>
            </thead>
            <tbody>
              {filter.rows.map((row) => (
                <tr key={row.id} style={{ borderTop: `1px solid ${tokens.hair}` }}>
                  <Td>{row.taskName}</Td>
                  <Td>
                    <div>{row.projectName}</div>
                    <Mono size={10} color={tokens.dim} style={{ display: 'block', marginTop: 2 }}>{row.specName}</Mono>
                  </Td>
                  <Td>
                    <div>{row.agentName}</div>
                    {row.agentModel && (
                      <Mono size={10} color={tokens.dim} style={{ display: 'block', marginTop: 2 }}>{row.agentModel}</Mono>
                    )}
                  </Td>
                  <Td>
                    <Mono size={11}>{row.stage}{row.terminalState ? ` · ${row.terminalState}` : ''}</Mono>
                  </Td>
                  <Td>
                    <CoverageBadge kind={row.coverageKind} />
                  </Td>
                  <Td align="right" mono>
                    <Mono size={10} color={tokens.dim}>{row.createdAt.slice(0, 10)}</Mono>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CoverageBadge({ kind }: { kind: string }) {
  const tone = kind === 'usage_missing' ? tokens.warn : kind === 'price_missing' ? tokens.info : tokens.dim
  const label = kind === 'usage_missing' ? 'usage missing' : kind === 'price_missing' ? 'price missing' : kind
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        background: `color-mix(in oklab, ${tone} 12%, transparent)`,
        color: tone,
        fontFamily: tokens.mono,
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {label}
    </span>
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

function Td({ children, align = 'left', mono }: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean }) {
  return (
    <td
      style={{
        textAlign: align,
        padding: '8px 10px',
        fontFamily: mono ? tokens.mono : tokens.sans,
        color: tokens.strong,
      }}
    >
      {children}
    </td>
  )
}

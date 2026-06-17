import type { EnrichedRun, Spec } from '@/api/client'
import { ago, Caps, Card, Mono, tokens, usd } from '@/components/signal'
import { WORKFLOW_STAGES } from '@/lib/stage-display'

export interface SpecRow {
  spec: Spec
  projectName: string
  runs: EnrichedRun[]
  taskCount: number
  costSum: number
  stageIdx: number
  failing: boolean
  awaiting: boolean
  liveCount: number
}

export function isLiveRun(run: EnrichedRun): boolean {
  return run.terminalState == null && run.stage !== 'done' && run.stage !== 'failed' && run.stage !== 'stalled'
}

export function specStatus(row: SpecRow) {
  // Stored spec status wins over historical run noise. A spec the
  // operator has marked done/failed should not be re-derived from
  // older runs that happen to have a failed terminal state.
  if (row.spec.status === 'done') return { key: 'done', label: 'done', color: tokens.ok }
  if (row.spec.status === 'failed') return { key: 'failed', label: 'failed', color: tokens.err }
  if (row.failing && row.liveCount > 0) return { key: 'recovering', label: 'recovering', color: tokens.warn }
  if (row.failing) return { key: 'failed', label: 'failed', color: tokens.err }
  if (row.awaiting) return { key: 'approval', label: 'approval', color: tokens.accent }
  if (row.liveCount > 0) return { key: 'active', label: 'in flight', color: tokens.info }
  if (row.runs.some((run) => run.stage === 'done')) {
    return { key: 'done', label: 'done', color: tokens.ok }
  }
  if (row.spec.status === 'blocked') return { key: 'blocked', label: 'blocked', color: tokens.err }
  return { key: row.spec.status || 'queued', label: row.spec.status || 'queued', color: tokens.mid }
}

export function SpecProjectSection({
  projectName,
  rows,
  onOpen,
}: {
  projectName: string
  rows: SpecRow[]
  onOpen: (row: SpecRow) => void
}) {
  // Header counts mirror stored spec.status so the meta line stays
  // honest. Live/derived states ("active", "recovering") would
  // double-count specs that already have a real spec.status badge.
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = row.spec.status ?? 'queued'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const STATUS_ORDER = ['done', 'approved', 'implementing', 'reviewed', 'draft', 'failed'] as const
  const orderedCounts = [...counts.entries()].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a[0] as typeof STATUS_ORDER[number])
    const bi = STATUS_ORDER.indexOf(b[0] as typeof STATUS_ORDER[number])
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  const meta = [
    `${rows.length} spec${rows.length === 1 ? '' : 's'}`,
    ...orderedCounts.map(([status, count]) => `${count} ${status}`),
  ].join(' · ')
  const failed = counts.get('failed') ?? 0

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline' }}>
        <Caps>{projectName}</Caps>
        <Mono size={11} color={failed > 0 ? tokens.err : tokens.mid}>{meta}</Mono>
      </div>
      <Card pad={0}>
        <div
          style={{
            padding: '14px 24px',
            display: 'grid',
            gridTemplateColumns: 'minmax(240px, 1fr) 150px 70px 100px 110px',
            gap: 24,
            borderBottom: `1px solid ${tokens.hair}`,
          }}
        >
          {['Spec', 'Stage', 'Tasks', 'Cost', 'Status'].map((heading) => (
            <Caps key={heading} style={{ fontSize: 9.5 }}>
              {heading}
            </Caps>
          ))}
        </div>
        {rows.map((row, index) => {
          const status = specStatus(row)
          return (
            <button
              type="button"
              key={row.spec.id}
              onClick={() => onOpen(row)}
              aria-label={`Open ${row.spec.name}`}
              className="group w-full text-left transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              style={{
                padding: '18px 24px',
                display: 'grid',
                gridTemplateColumns: 'minmax(240px, 1fr) 150px 70px 100px 110px',
                gap: 24,
                alignItems: 'center',
                borderBottom: index === rows.length - 1 ? 'none' : `1px solid ${tokens.hair}`,
                borderTop: 'none',
                borderLeft: 'none',
                borderRight: 'none',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: tokens.sans,
                    fontSize: 19,
                    fontWeight: 500,
                    color: tokens.strong,
                    letterSpacing: -0.2,
                  }}
                >
                  {row.spec.name}
                </div>
                <Mono size={11} color={tokens.dim} style={{ marginTop: 2, display: 'block' }}>
                  opened {ago(row.spec.createdAt)} ago
                </Mono>
              </div>
              <StageLine stageIdx={row.stageIdx} statusKey={status.key} />
              <Mono size={13} color={tokens.fg}>{row.taskCount}</Mono>
              <Mono size={13} color={tokens.fg}>{usd(row.costSum)}</Mono>
              <Mono size={12} color={status.color}>{status.label}</Mono>
            </button>
          )
        })}
      </Card>
    </section>
  )
}

function StageLine({
  stageIdx,
  statusKey,
}: {
  stageIdx: number
  statusKey: string
}) {
  const failing = statusKey === 'failed' || statusKey === 'recovering'
  const awaiting = statusKey === 'approval'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 6 }}>
      {WORKFLOW_STAGES.map((label, index) => {
        const done = index < stageIdx
        const active = index === stageIdx
        const color = failing
          ? tokens.err
          : awaiting && active
            ? tokens.accent
            : done
              ? tokens.mid
              : active
                ? tokens.strong
                : tokens.hair
        return (
          <div
            key={label}
            title={label}
            style={{
              width: 24,
              height: active ? 3 : 2,
              background: color,
              borderRadius: 1,
            }}
          />
        )
      })}
      <Mono size={10} color={tokens.dim} style={{ marginLeft: 6 }}>
        {failing ? statusKey : awaiting ? 'approval' : (WORKFLOW_STAGES[stageIdx] ?? 'unknown')}
      </Mono>
    </div>
  )
}

import type { GateEvaluation } from '@/api/client'
import { Caps, Dot, Mono, statusOf, tokens } from '@/components/signal'
import { STAGE_LABEL, WORKFLOW_STAGES } from '@/lib/stage-display'
import { formatTime } from '@/lib/utils'
import type { RunType } from './types'

export function EnforcementPanel({ run, gates }: { run: RunType; gates: GateEvaluation[] }) {
  const currentStage = run.stage
  const completedStages = run.completedStages ?? []
  const runStatus = statusOf(run)
  const isFailed = runStatus.kind === 'failed' || runStatus.kind === 'stalled'
  const isDone = run.stage === 'done'
  const allowed = gates.filter((g) => g.result === 'allowed').length
  const blocked = gates.filter((g) => g.result === 'blocked').length
  const recentBlocks = groupRecentBlocks(gates)

  function stageStatus(stage: string): 'completed' | 'current' | 'future' | 'failed' {
    if (isDone) return 'completed'
    if (isFailed && stage === currentStage) return 'failed'
    if (stage === currentStage) return 'current'
    if (completedStages.includes(stage)) return 'completed'
    const currentIdx = WORKFLOW_STAGES.indexOf(currentStage as (typeof WORKFLOW_STAGES)[number])
    const stageIdx = WORKFLOW_STAGES.indexOf(stage as (typeof WORKFLOW_STAGES)[number])
    if (currentIdx >= 0 && stageIdx >= 0 && stageIdx < currentIdx) return 'completed'
    return 'future'
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Caps style={{ fontSize: 9 }}>Workflow stage</Caps>
        {gates.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <Mono size={11} color={tokens.ok}>{allowed} allowed</Mono>
            {blocked > 0 && <Mono size={11} color={tokens.err}>{blocked} blocked</Mono>}
            <Mono size={11} color={tokens.faint}>{gates.length} evals</Mono>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
        {WORKFLOW_STAGES.map((stage, i) => {
          const status = stageStatus(stage)
          const col = status === 'completed' ? tokens.ok : status === 'current' ? tokens.accent : status === 'failed' ? tokens.err : tokens.faint
          return (
            <div key={stage} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div style={{ width: 12, height: 1, background: col, opacity: 0.5, marginRight: 4 }} />}
              <div
                style={{
                  padding: '5px 10px',
                  border: `1px solid ${col}`,
                  borderRadius: 6,
                  background: status === 'current' ? `color-mix(in oklab, ${col} 15%, transparent)` : 'transparent',
                  fontFamily: tokens.mono,
                  fontSize: 10,
                  color: col,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  fontWeight: status === 'current' ? 600 : 400,
                }}
              >
                {STAGE_LABEL[stage] ?? stage}
              </div>
            </div>
          )
        })}
      </div>
      {recentBlocks.length > 0 && (
        <div style={{ marginTop: 16, padding: 12, border: `1px solid color-mix(in oklab, ${tokens.err} 25%, transparent)`, borderRadius: 8, background: `color-mix(in oklab, ${tokens.err} 6%, transparent)` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Dot color={tokens.err} size={6} />
            <Caps color={tokens.err} style={{ fontSize: 9 }}>Recent blocks</Caps>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentBlocks.map((g) => (
              <div key={g.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontFamily: tokens.mono, fontSize: 11 }}>
                <Mono size={10} color={tokens.faint}>{formatTime(g.createdAt)}</Mono>
                <span style={{ color: tokens.err, fontWeight: 600 }}>{g.target}</span>
                <span style={{ flex: 1, color: tokens.mid, minWidth: 0, wordBreak: 'break-word' }}>{g.reason ?? 'no reason'}</span>
                {g.count > 1 && <Mono size={10} color={tokens.err}>×{g.count}</Mono>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function groupRecentBlocks(gates: GateEvaluation[]) {
  const allBlocks = gates.filter((g) => g.result === 'blocked')
  type Group = { id: number; target: string; reason: string | null; createdAt: string; count: number }
  const groups: Group[] = []
  for (const g of allBlocks) {
    const last = groups[groups.length - 1]
    if (last != null && last.target === g.target && (last.reason ?? null) === (g.reason ?? null)) {
      last.count += 1
      last.createdAt = g.createdAt
    } else {
      groups.push({ id: g.id, target: g.target, reason: g.reason, createdAt: g.createdAt, count: 1 })
    }
  }
  return groups.slice(-5).reverse()
}

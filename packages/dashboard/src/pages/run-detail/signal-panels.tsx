import type { RunActivity } from '@/api/client'
import { Caps, Dot, Mono, statusOf, tokens } from '@/components/signal'
import { isAwaitingApproval } from '@/lib/derived-status'
import { stageLabel, WORKFLOW_STAGES } from '@/lib/stage-display'
import { shortId } from '@/lib/display'
import { operatorActivityLabel } from '@/lib/run-activity-labels'
import type { RunType } from './types'

export function StatCell({
  label,
  value,
  subtle,
  color,
  last,
}: {
  label: string
  value: string
  subtle?: string
  color?: string
  last?: boolean
}) {
  return (
    <div style={{ padding: '16px 20px', borderRight: last ? 'none' : `1px solid ${tokens.hair}` }}>
      <Caps style={{ fontSize: 9 }}>{label}</Caps>
      <div
        style={{
          marginTop: 8,
          fontFamily: tokens.sans,
          fontSize: 22,
          fontWeight: 500,
          color: color ?? tokens.strong,
          letterSpacing: -0.3,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {subtle && (
        <Mono size={11} color={tokens.dim} style={{ marginTop: 4, display: 'block' }}>
          {subtle}
        </Mono>
      )}
    </div>
  )
}

function nextTransition(run: RunType): string {
  if (run.terminalState === 'failed') return 'Terminal. Requires human decision to resume or abandon.'
  if (run.terminalState === 'stalled') return 'Terminal. Session lost; needs resume or reassign.'
  if (run.terminalState === 'cancelled') return 'Terminal. Cancelled by operator.'
  if (run.stage === 'done') return run.commitSha ? `Terminal. Merged to main ${run.commitSha.slice(0, 7)}.` : 'Terminal. Marked done.'
  if (isAwaitingApproval(run)) return 'On human approval → merge and mark done'
  if (run.stage === 'ship') return 'On CI completion → post evidence, mark done'
  if (run.stage === 'implement') return 'On first commit push → ship'
  if (run.stage === 'understand') return 'On plan complete → implement'
  return 'Awaiting next gate evaluation.'
}

export function SignalStateMachine({ run }: { run: RunType }) {
  const nodes = WORKFLOW_STAGES
  const runStatus = statusOf(run)
  const isTerminal = runStatus.kind === 'failed' || runStatus.kind === 'stalled' || runStatus.kind === 'cancelled'
  const completed = new Set(run.completedStages ?? [])
  const curIdx = nodes.indexOf(run.stage as (typeof nodes)[number])
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
        {nodes.map((n, i) => {
          const past = completed.has(n) || (curIdx >= 0 && i < curIdx)
          const now = i === curIdx && !isTerminal
          const terminalHere = isTerminal && i === curIdx
          const terminalColor = runStatus.kind === 'cancelled' ? tokens.mid : tokens.err
          const col = terminalHere ? terminalColor : now ? tokens.accent : past ? tokens.mid : tokens.faint
          return (
            <div key={n} style={{ display: 'flex', alignItems: 'stretch', flex: i < nodes.length - 1 ? 1 : 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '0 4px' }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 10,
                    background: now || terminalHere ? col : past ? tokens.mid : 'transparent',
                    border: `1.5px solid ${col}`,
                  }}
                />
                <Mono size={10} color={col} style={{ textAlign: 'center' }}>
                  {stageLabel(n).toLowerCase()}
                </Mono>
              </div>
              {i < nodes.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: past ? tokens.mid : tokens.hair,
                    alignSelf: 'center',
                    marginTop: -18,
                    minWidth: 14,
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 18, padding: 14, background: tokens.sunken, borderRadius: 8, border: `1px solid ${tokens.hair}` }}>
        <Caps style={{ fontSize: 9 }}>Next transition</Caps>
        <div style={{ marginTop: 6, fontFamily: tokens.sans, fontSize: 13, color: tokens.fg }}>{nextTransition(run)}</div>
      </div>
    </div>
  )
}

export function SignalActivityPreview({ activity }: { activity: RunActivity[] }) {
  const kindColor: Record<string, string> = {
    tool_call: tokens.info,
    tool_result: tokens.info,
    text: tokens.mid,
    summary: tokens.ok,
    result: tokens.accent,
  }
  if (activity.length === 0) {
    return (
      <div style={{ padding: '22px 24px' }}>
        <Mono size={11} color={tokens.dim}>Waiting for agent activity…</Mono>
      </div>
    )
  }
  const recent = activity.slice(-10).reverse()
  return (
    <div>
      {recent.map((a) => {
        const c = kindColor[a.kind] ?? tokens.faint
        const label = operatorActivityLabel(a)
        return (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '54px 12px 1fr auto', gap: 10, padding: '10px 24px', alignItems: 'baseline' }}>
            <Mono size={11} color={tokens.dim}>{new Date(a.createdAt).toISOString().slice(11, 19)}</Mono>
            <div style={{ width: 6, height: 6, borderRadius: 3, background: c, marginTop: 6, justifySelf: 'center' }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: tokens.fg, lineHeight: 1.4, wordBreak: 'break-word' }}>{label.title}</div>
              <Mono size={10.5} color={tokens.faint} style={{ marginTop: 2, display: 'block' }}>
                {label.meta ?? a.toolName ?? a.kind}
              </Mono>
            </div>
            <Mono size={11} color={tokens.dim}>{shortId(a.runId)}</Mono>
          </div>
        )
      })}
    </div>
  )
}

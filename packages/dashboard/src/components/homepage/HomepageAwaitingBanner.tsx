import { useNavigate } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { Btn, Caps, Dot, Mono, tokens, ago } from '@/components/signal'
import { runCost, runHref } from '@/lib/run-presentation'

function openRun(navigate: ReturnType<typeof useNavigate>, run: EnrichedRun) {
  navigate(runHref(run))
}

export function HomepageAwaitingBanner({ run }: { run: EnrichedRun }) {
  const navigate = useNavigate()
  const ciTone = run.ciStatus === 'pass' ? tokens.ok : run.ciStatus === 'fail' ? tokens.err : tokens.mid
  const reviewTone = run.reviewStatus === 'pass' ? tokens.ok : run.reviewStatus === 'fail' ? tokens.err : tokens.mid

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: tokens.canvas,
        border: `1px solid color-mix(in oklab, ${tokens.accent} 30%, transparent)`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: `inset 3px 0 0 ${tokens.accent}`,
      }}
    >
      <div style={{ flex: 1, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Dot color={tokens.accent} pulse size={8} />
          <Caps color={tokens.accent} style={{ fontSize: 10 }}>Ship stage · awaiting human approval</Caps>
          <div style={{ flex: 1 }} />
          <Mono size={11} color={tokens.dim}>idle {ago(run.lastHeartbeat ?? run.updatedAt)}</Mono>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: tokens.mono, fontSize: 20, fontWeight: 500, letterSpacing: -0.2, color: tokens.strong }}>
            {run.taskName}
          </span>
          <span style={{ color: tokens.dim }}>·</span>
          <span style={{ color: tokens.mid, fontWeight: 400, fontSize: 18 }}>{run.specName}</span>
        </div>
        {run.completionSummary && (
          <div style={{ marginTop: 4, color: tokens.mid, fontSize: 13.5 }}>{run.completionSummary}</div>
        )}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          <EvidenceBit label="CI" value={run.ciStatus ?? 'pending'} color={ciTone} />
          <EvidenceBit label="Review" value={run.reviewStatus ?? 'pending'} color={reviewTone} />
          <EvidenceBit label="Cost" value={runCost(run).label} color={tokens.mid} />
          <EvidenceBit label="Agent" value={run.agentName} color={tokens.mid} />
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 24px',
          gap: 8,
          borderLeft: `1px solid ${tokens.hair}`,
          justifyContent: 'center',
          background: tokens.sunken,
        }}
      >
        <Btn primary onClick={() => openRun(navigate, run)}>Review &amp; approve</Btn>
        <Btn onClick={() => openRun(navigate, run)}>Open attempt</Btn>
      </div>
    </div>
  )
}

function EvidenceBit({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div>
      <Caps style={{ fontSize: 9, letterSpacing: 1.4 }}>{label}</Caps>
      <Mono size={12} color={color} style={{ marginTop: 4, display: 'block' }}>
        {value}
      </Mono>
    </div>
  )
}

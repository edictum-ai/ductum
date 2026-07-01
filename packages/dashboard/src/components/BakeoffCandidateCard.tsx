import { Btn, Dot, Mono, tokens, usd } from '@/components/signal'
import { toneColor } from '@/components/signal/tokens'
import { runDisplayStatus, runStatusTone } from '@/lib/run-presentation'
import type { BakeoffCompareCandidateView } from '@/components/BakeoffComparePanel'

export function BakeoffCandidateCard({
  candidate,
  label,
  onOpenTask,
  onOpenRun,
}: {
  candidate: BakeoffCompareCandidateView
  label: string
  onOpenTask?: () => void
  onOpenRun?: () => void
}) {
  const tone = candidate.latest ? toneColor(runStatusTone(candidate.latest)) : tokens.dim
  return (
    <section style={{ border: `1px solid ${candidate.winner ? tokens.ok : tokens.hair}`, borderRadius: 8, padding: 14, background: tokens.raised }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
        <Mono size={11} color={candidate.winner ? tokens.ok : tokens.accent}>{candidate.winner ? 'Winner' : label}</Mono>
        <Dot color={tone} size={7} pulse={candidate.latest != null && runDisplayStatus(candidate.latest) === 'running'} />
      </div>
      <h3 style={{ margin: '10px 0 4px', fontSize: 16, color: tokens.strong }}>{candidate.taskName}</h3>
      <Mono size={11} color={tokens.mid}>{candidate.agentName} · {candidate.agentModel}{candidate.agentProvider == null ? '' : ` · ${candidate.agentProvider}`}</Mono>
      <MetricGrid rows={[
        ['status', candidate.status],
        ['tokens', candidate.tokensTotal === 0 ? 'missing usage' : candidate.tokensTotal.toLocaleString()],
        ['cost', candidate.costUnmeasured ? candidate.tokensTotal > 0 ? 'missing price' : 'missing usage' : usd(candidate.costUsd)],
        ['elapsed', formatElapsed(candidate.elapsedSeconds)],
        ['verify', candidate.verifyPassed == null ? `${candidate.verifyFailures} failures` : candidate.verifyPassed ? 'passed' : 'failed'],
        ['review passes', String(candidate.reviewPasses)],
        ['fix rounds', String(candidate.fixRounds)],
        ['overall score', scoreLabel(candidate.scores?.overall)],
        ['cost score', scoreLabel(candidate.scores?.costEfficiency)],
        ['outcome', candidate.outcome ?? 'pending'],
        ['eligible', candidate.eligible == null ? 'unknown' : candidate.eligible ? 'yes' : 'no'],
        ['artifact', artifactLabel(candidate)],
      ]} />
      {candidate.scores != null && <MetricGrid rows={[
        ['implementation', scoreLabel(candidate.scores.implementation)],
        ['review', scoreLabel(candidate.scores.review)],
        ['tests', scoreLabel(candidate.scores.tests)],
        ['confidence', candidate.scores.reviewerConfidence == null ? 'unknown' : `${Math.round(candidate.scores.reviewerConfidence * 100)}%`],
      ]} />}
      {candidate.notes != null && <Mono size={11} color={tokens.mid} style={{ display: 'block', marginTop: 10 }}>{candidate.notes}</Mono>}
      {candidate.blockers.length > 0 && <Mono size={10} color={tokens.err} style={{ display: 'block', marginTop: 8 }}>{candidate.blockers[0]}</Mono>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <Btn small disabled={onOpenTask == null} onClick={onOpenTask}>Open task</Btn>
        <Btn small disabled={onOpenRun == null} onClick={onOpenRun}>Open attempt</Btn>
      </div>
    </section>
  )
}

function MetricGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <Mono size={10} color={tokens.faint}>{label}</Mono>
          <div style={{ marginTop: 2 }}><Mono size={11} color={tokens.fg}>{value}</Mono></div>
        </div>
      ))}
    </div>
  )
}

function scoreLabel(value: number | undefined) {
  return value == null ? 'unknown' : `${value.toFixed(1)}/10`
}

function formatElapsed(seconds: number | null) {
  if (seconds == null) return 'unknown'
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

function artifactLabel(candidate: BakeoffCompareCandidateView) {
  if (candidate.prUrl != null) return 'PR'
  if (candidate.commitSha != null) return candidate.commitSha.slice(0, 8)
  if (candidate.branch != null) return candidate.branch
  if ((candidate.worktreePaths?.length ?? 0) > 0) return 'worktree'
  return 'none'
}

import type { Agent, GateEvaluation, RunActivity, RunDiff } from '@/api/client'
import { DiffViewer } from '@/components/DiffViewer'
import { CompletionSummaryCard } from '@/components/run/CompletionSummaryCard'
import { FailureSummaryCard } from '@/components/run/FailureSummaryCard'
import { RunLineageBreadcrumb } from '@/components/run/RunLineageTree'
import { Caps, Card, CardHeader, agentColor, ago, fmt, isLive, tokens } from '@/components/signal'
import { runCost } from '@/lib/run-presentation'
import { stageLabel } from '@/lib/stage-display'
import { EnforcementPanel } from './enforcement-panel'
import { SignalActivityPreview, SignalStateMachine, StatCell } from './signal-panels'
import type { ProjectType, RunType, SpecType, TaskType } from './types'

export function RunStatusSummaries({
  run,
  activity,
  siblingRuns,
  project,
  spec,
  task,
  nextTaskHref,
  isFailing,
  needsApproval,
  isDone,
}: {
  run: RunType
  activity: RunActivity[]
  siblingRuns: RunType[]
  project: ProjectType | undefined
  spec: SpecType | undefined
  task: TaskType | undefined
  nextTaskHref?: string
  isFailing: boolean
  needsApproval: boolean
  isDone: boolean
}) {
  return (
    <>
      {project && spec && (
        <div style={{ marginBottom: 20 }}>
          <RunLineageBreadcrumb projectName={project.name} specName={spec.name} runId={run.id} />
        </div>
      )}
      {isFailing && project && spec && task && (
        <div style={{ marginBottom: 24 }}>
          <FailureSummaryCard run={run} activity={activity} siblingRuns={siblingRuns} projectName={project.name} specName={spec.name} taskName={task.name} />
        </div>
      )}
      {!isFailing && !needsApproval && run.blockedReason && (
        <div style={{ background: tokens.canvas, border: `1px solid color-mix(in oklab, ${tokens.warn} 25%, transparent)`, borderRadius: 10, padding: '18px 24px', marginBottom: 24, boxShadow: `inset 3px 0 0 ${tokens.warn}` }}>
          <Caps color={tokens.warn}>Blocked</Caps>
          <div style={{ marginTop: 8, fontFamily: tokens.sans, fontSize: 16, color: tokens.strong, lineHeight: 1.4 }}>{run.blockedReason}</div>
        </div>
      )}
      {isDone && (
        <div style={{ marginBottom: 24 }}>
          <CompletionSummaryCard
            run={run}
            activity={activity}
            nextTaskHref={nextTaskHref}
          />
        </div>
      )}
    </>
  )
}

export function RunStatsStrip({ run, agent }: { run: RunType; agent: Agent | undefined }) {
  const cost = runCost(run)
  const tokensValue = run.tokensIn === 0 && run.tokensOut === 0
    ? cost.state === 'unmeasured' ? 'unmeasured' : 'pending'
    : `${fmt(run.tokensIn)} / ${fmt(run.tokensOut)}`
  const tokensSubtle = run.tokensIn === 0 && run.tokensOut === 0
    ? cost.state === 'unmeasured' ? 'harness did not report tokens' : 'not reported yet'
    : 'in / out'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', border: `1px solid ${tokens.hair}`, borderRadius: 10, background: tokens.canvas, marginBottom: 24 }}>
      <StatCell label="Agent" value={agent?.name ?? 'Agent'} subtle={agent?.model ?? 'unknown'} color={agentColor(agent?.id)} />
      <StatCell label="Cost" value={cost.label} subtle={cost.state === 'unmeasured' ? 'harness did not report usage' : cost.state === 'unpriced' ? 'usage known, no price for model' : undefined} />
      <StatCell label="Tokens" value={tokensValue} subtle={tokensSubtle} />
      <StatCell label="Started" value={ago(run.createdAt) + ' ago'} />
      <StatCell label="Last beat" value={run.lastHeartbeat ? ago(run.lastHeartbeat) + ' ago' : '—'} color={isLive(run) && run.lastHeartbeat ? tokens.ok : tokens.dim} />
      <StatCell label="Commits" value={run.prNumber != null ? `PR #${run.prNumber}` : run.commitSha ? run.commitSha.slice(0, 7) : '—'} subtle={run.branch ?? undefined} last />
    </div>
  )
}

export function RunSignalGrid({ run, gates, activity }: { run: RunType; gates: GateEvaluation[]; activity: RunActivity[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 24, marginBottom: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
        <Card>
          <CardHeader title="State machine" meta={`current · ${stageLabel(run.stage)}`} />
          <SignalStateMachine run={run} />
        </Card>
        <Card>
          <CardHeader title="Enforcement" meta={gates.length > 0 ? `${gates.length} evaluations` : 'no evaluations yet'} />
          <EnforcementPanel run={run} gates={gates} />
        </Card>
      </div>
      <Card pad={0} style={{ minWidth: 0 }}>
        <div style={{ padding: '20px 24px 0' }}>
          <CardHeader title="Activity" meta={isLive(run) ? 'live' : 'paused'} />
        </div>
        <div style={{ paddingBottom: 16 }}>
          <SignalActivityPreview activity={activity} />
        </div>
      </Card>
    </div>
  )
}

export function RunDiffCard({ diff, diffLoading, diffError }: { diff: RunDiff | undefined; diffLoading: boolean; diffError: unknown }) {
  return (
    <Card pad={0} style={{ marginBottom: 24 }}>
      <div style={{ padding: '20px 24px 0' }}>
        <CardHeader title="Changes vs main" meta={diff?.totals?.files != null ? `${diff.totals.files} file${diff.totals.files === 1 ? '' : 's'}` : '—'} />
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        <DiffViewer diff={diff} isLoading={diffLoading} error={diffError} />
      </div>
    </Card>
  )
}

export function RunApprovalCard({
  run,
}: {
  run: RunType
}) {
  return (
    <Card style={{ marginBottom: 24 }}>
      <Caps>Awaiting approval</Caps>
      <div style={{ marginTop: 8, fontSize: 14, color: tokens.mid, lineHeight: 1.5, maxWidth: 680 }}>
        This attempt is ready to ship. Review the changes above before approval.
        {run.prUrl && (
          <>
            {' '}
            <a href={run.prUrl} target="_blank" rel="noopener noreferrer" style={{ color: tokens.accent }}>PR #{run.prNumber}</a>
          </>
        )}
      </div>
    </Card>
  )
}

import type { Agent, GateEvaluation, RunActivity, RunDiff } from '@/api/client'
import { DiffViewer } from '@/components/DiffViewer'
import { CompletionSummaryCard } from '@/components/run/CompletionSummaryCard'
import { FailureSummaryCard } from '@/components/run/FailureSummaryCard'
import { RunLineageBreadcrumb } from '@/components/run/RunLineageTree'
import { Caps, Card, CardHeader, agentColor, ago, fmt, isLive, tokens } from '@/components/signal'
import { runCost } from '@/lib/run-presentation'
import { latchTone, stageLabel } from '@/lib/stage-display'
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
    ? cost.state === 'unmeasured' ? 'missing usage' : 'pending'
    : `${fmt(run.tokensIn)} / ${fmt(run.tokensOut)}`
  const tokensSubtle = run.tokensIn === 0 && run.tokensOut === 0
    ? cost.state === 'unmeasured' ? 'harness did not report tokens' : 'not reported yet'
    : 'in / out'
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6"
      style={{ border: `1px solid ${tokens.hair}`, borderRadius: 10, background: tokens.canvas, marginBottom: 24 }}
    >
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
    <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr]" style={{ gap: 24, marginBottom: 24 }}>
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

export function RunDiffCard({
  diff,
  diffLoading,
  diffError,
  title = 'Changes vs main',
  unavailableReason = null,
}: {
  diff: RunDiff | undefined
  diffLoading: boolean
  diffError: unknown
  /** When set, the card renders an explicit unavailable state instead of
   *  hitting DiffViewer. Use to tell operators why no diff is shown when
   *  the attempt has no preserved worktree (issue #211). */
  unavailableReason?: string | null
  title?: string
}) {
  const meta = unavailableReason != null
    ? 'unavailable'
    : diff?.totals?.files != null
      ? `${diff.totals.files} file${diff.totals.files === 1 ? '' : 's'}`
      : '—'
  return (
    <Card pad={0} style={{ marginBottom: 24 }}>
      <div style={{ padding: '20px 24px 0' }}>
        <CardHeader title={title} meta={meta} />
      </div>
      <div style={{ padding: '0 20px 20px' }}>
        {unavailableReason != null ? (
          <div
            style={{
              border: `1px solid ${tokens.hair}`,
              background: tokens.sunken,
              borderRadius: 8,
              padding: '16px 18px',
              color: tokens.mid,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <Caps color={tokens.dim}>Diff unavailable</Caps>
            <div style={{ marginTop: 8, fontFamily: tokens.sans, color: tokens.strong }}>
              {unavailableReason}
            </div>
          </div>
        ) : (
          <DiffViewer diff={diff} isLoading={diffLoading} error={diffError} />
        )}
      </div>
    </Card>
  )
}

/** Surface external PR / CI context for the attempt. Renders only when the
 *  run carries a real PR URL or CI latch value. PR links use run.prUrl; CI is
 *  status-only until the run contract exposes a real check URL. */
export function RunLinksCard({ run }: { run: RunType }) {
  const prUrl = run.prUrl ?? null
  const ciStatus = run.ciStatus ?? null
  if (prUrl == null && ciStatus == null) return null
  const ciTone = ciStatus == null ? null : latchTone(ciStatus)
  const ciColor = ciTone == null ? tokens.mid : toneColorFor(ciTone)
  return (
    <Card pad={0} style={{ marginBottom: 24 }}>
      <div style={{ padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <Caps color={tokens.dim}>External context</Caps>
        {prUrl != null && (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.accent }}
            title={prUrl}
          >
            PR #{run.prNumber ?? '?'} ↗
          </a>
        )}
        {ciStatus != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: tokens.mono, fontSize: 12 }}>
            <span style={{ color: tokens.dim }}>CI:</span>
            <span style={{ color: ciColor }}>{ciStatus}</span>
          </span>
        )}
      </div>
    </Card>
  )
}

function toneColorFor(tone: 'ok' | 'err' | 'warn' | 'info' | 'accent' | 'mid'): string {
  if (tone === 'ok') return tokens.ok
  if (tone === 'err') return tokens.err
  if (tone === 'warn') return tokens.warn
  if (tone === 'info') return tokens.info
  if (tone === 'accent') return tokens.accent
  return tokens.mid
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

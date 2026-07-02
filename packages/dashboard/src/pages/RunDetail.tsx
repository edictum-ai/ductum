import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { api } from '@/api/client'
import {
  useAgents,
  useApproveRun,
  useApproveRunWithRebase,
  useBudgetDeny,
  useBudgetExtend,
  useCancelRun,
  useCleanupRunWorktree,
  useDecisions,
  usePauseRun,
  useRejectRun,
  useRedirectRun,
  useResumeRun,
  useResolveRun,
  useRetryRun,
  useRunActivity,
  useRunDiff,
  useRunEvidence,
  useRunGateEvals,
  useRunHistory,
  useRuns,
  useRunUpdates,
  useTasks,
  useTurnsDeny,
  useTurnsExtend,
} from '@/api/hooks'
import { useDuctumSSE } from '@/api/sse'
import { statusOf, tokens, toneColor } from '@/components/signal'
import { isAwaitingApproval } from '@/lib/derived-status'
import { runCanRetry } from '@/lib/run-presentation'
import { parseReviewResultSummary } from '@/lib/review-result'
import {
  diffUnavailableReason,
  hasPreservedWorktree,
  shouldLoadRunDiff,
} from './run-detail/diff-availability'
import { RunDetailTabs } from './run-detail/detail-tabs'
import { RunDetailHero } from './run-detail/hero'
import { LegacyAttemptBanner } from './run-detail/legacy-attempt-banner'
import { RunControls } from './run-detail/run-controls'
import { RunRedirectControl } from './run-detail/run-redirect-control'
import { RunRecoveryControls } from './run-detail/run-recovery-controls'
import {
  RunApprovalCard,
  RunDiffCard,
  RunLinksCard,
  RunSignalGrid,
  RunStatsStrip,
  RunStatusSummaries,
} from './run-detail/overview-panels'
import { enc } from './run-detail/transcript'
import type { RunType, TaskType } from './run-detail/types'

const NEXT_TASK_STATUSES = new Set(['ready', 'pending', 'active', 'in-progress'])

function nextTaskHref(
  tasks: TaskType[],
  currentTask: TaskType | undefined,
  projectName: string | undefined,
  specName: string | undefined,
): string | undefined {
  if (!currentTask || !projectName || !specName) return undefined
  const currentIndex = tasks.findIndex((item) => item.id === currentTask.id)
  const candidates = currentIndex >= 0 ? tasks.slice(currentIndex + 1) : tasks
  const next = candidates.find((item) => NEXT_TASK_STATUSES.has(item.status))
  return next ? `/${enc(projectName)}/${enc(specName)}/${enc(next.name)}` : undefined
}

export function RunDetail() {
  const { project: projectSlug, spec: specSlug, task: taskSlug, runId: runIdSlug } = useParams<{
    project: string; spec: string; task: string; runId: string
  }>()
  const navigate = useNavigate()

  const { data: resolved } = useResolveRun(projectSlug ?? '', specSlug ?? '', taskSlug ?? '', runIdSlug ?? '')
  const project = resolved?.project
  const spec = resolved?.spec
  const task = resolved?.task
  const run = resolved?.run
  const runId = run?.id ?? ''
  const runStatus = run == null ? null : statusOf(run)
  const blocked = run?.blockedReason != null && run.blockedReason.trim() !== ''
  const running = runStatus != null && !blocked && (
    runStatus.kind === 'running'
    || runStatus.kind === 'fixing'
    || runStatus.kind === 'reviewing'
    || runStatus.kind === 'watching'
  )
  const hasWorktree = run != null && hasPreservedWorktree(run)
  const shouldLoadDiff = run != null && shouldLoadRunDiff(run)
  const { data: attempt } = useQuery({
    queryKey: ['attempt', runId],
    queryFn: () => api.getAttempt(runId),
    enabled: runId.length > 0,
  })

  const sse = useDuctumSSE({ runId })

  const { data: agents = [] } = useAgents()
  const { data: siblingRuns = [] } = useRuns(task?.id ?? '')
  const { data: specTasks = [] } = useTasks(spec?.id ?? '')
  const { data: evidence = [] } = useRunEvidence(runId)
  const { data: transitions = [] } = useRunHistory(runId)
  const { data: gates = [] } = useRunGateEvals(runId)
  const { data: decisions = [] } = useDecisions(runId ? { runId } : {})
  const { data: updates = [] } = useRunUpdates(runId)
  const { data: activity = [] } = useRunActivity(runId)
  const { data: diff, isLoading: diffLoading, error: diffError } = useRunDiff(runId, {
    enabled: shouldLoadDiff,
    refetchInterval: running && hasWorktree ? 3000 : false,
  })
  const approveRun = useApproveRun()
  const approveRebase = useApproveRunWithRebase()
  const rejectRun = useRejectRun()
  const retryRun = useRetryRun()
  const pauseRun = usePauseRun()
  const resumeRun = useResumeRun()
  const redirectRun = useRedirectRun()
  const cancelRun = useCancelRun()
  const budgetExtend = useBudgetExtend()
  const budgetDeny = useBudgetDeny()
  const turnsExtend = useTurnsExtend()
  const turnsDeny = useTurnsDeny()
  const cleanupWorktree = useCleanupRunWorktree()

  if (!run) {
    return (
      <div style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }}>
        <div className="shimmer" style={{ height: 240, borderRadius: 10, border: `1px solid ${tokens.hair}`, background: tokens.canvas }} />
      </div>
    )
  }

  const agent = agents.find((a) => a.id === run.agentId)
  const status = runStatus ?? statusOf(run)
  const needsApproval = status.kind === 'approval'
  const staleApproval = isStaleApproval(run)
  const isFailing = status.kind === 'failed' || status.kind === 'stalled'
  // Issue #211: failed, stalled, and running attempts must surface their
  // worktree diff on the run page — not only approval. The diff surface is
  // gated on either pending approval or being a non-done attempt with a
  // preserved worktree; an explicit unavailable state covers the cases where
  // the worktree is missing (not yet created, or cleaned up).
  const showDiffCard = needsApproval || isFailing || running
  const diffUnavailable = showDiffCard && !hasWorktree ? diffUnavailableReason(run, running) : null
  const diffCardTitle = needsApproval ? 'Changes vs main' : 'Worktree changes vs main'
  const canCancel = run.terminalState == null && run.stage !== 'done'
  const canPause = run.terminalState == null && run.stage !== 'done'
  const canResume = run.terminalState === 'paused'
  const canRetry = runCanRetry(run)
  const redirectAgents = agents.filter((item) => item.id !== run.agentId)
  const canRedirect = canCancel && redirectAgents.length > 0
  const taskTitle = task?.name ?? run.id
  const summaryText = runHeroSummary(run)

  return (
    <div className="fade-in" style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }}>
      <RunDetailHero
        run={run}
        taskTitle={taskTitle}
        summaryText={summaryText}
        statusLabel={status.label}
        toneColor={toneColor(status.tone)}
        running={running}
        approval={needsApproval}
        activity={activity}
      />
      <RunControls
        run={run}
        canApprove={needsApproval && !staleApproval}
        canApproveRebase={needsApproval && staleApproval}
        canReject={needsApproval}
        canRetry={canRetry && project != null && spec != null && task != null}
        canPause={canPause}
        canResume={canResume}
        canCancel={canCancel}
        approvePending={approveRun.isPending}
        approveRebasePending={approveRebase.isPending}
        rejectPending={rejectRun.isPending}
        retryPending={retryRun.isPending}
        pausePending={pauseRun.isPending}
        resumePending={resumeRun.isPending}
        cancelPending={cancelRun.isPending}
        approveError={approveRun.isError ? approveRun.error : null}
        approveRebaseError={approveRebase.isError ? approveRebase.error : null}
        rejectError={rejectRun.isError ? rejectRun.error : null}
        retryError={retryRun.isError ? retryRun.error : null}
        pauseError={pauseRun.isError ? pauseRun.error : null}
        resumeError={resumeRun.isError ? resumeRun.error : null}
        cancelError={cancelRun.isError ? cancelRun.error : null}
        onApprove={(input) => approveRun.mutate(input)}
        onApproveRebase={(inputRunId) => approveRebase.mutate(inputRunId)}
        onReject={(input) => rejectRun.mutate(input)}
        onRetry={(input) => {
          if (!project || !spec || !task) return
          retryRun.mutate(input, {
            onSuccess: () => navigate(`/${enc(project.name)}/${enc(spec.name)}/${enc(task.name)}`),
          })
        }}
        onPause={(input) => pauseRun.mutate(input)}
        onResume={(input) => resumeRun.mutate(input)}
        onCancel={(input) => cancelRun.mutate(input)}
      />
      {canRedirect && (
        <RunRedirectControl
          run={run}
          agents={redirectAgents}
          canRedirect={canRedirect}
          pending={redirectRun.isPending}
          error={redirectRun.isError ? redirectRun.error : null}
          onRedirect={(input) => {
            if (!project || !spec || !task) return
            redirectRun.mutate(input, {
              onSuccess: () => navigate(`/${enc(project.name)}/${enc(spec.name)}/${enc(task.name)}`),
            })
          }}
        />
      )}
      <RunRecoveryControls
        run={run}
        budgetExtendPending={budgetExtend.isPending}
        budgetDenyPending={budgetDeny.isPending}
        turnsExtendPending={turnsExtend.isPending}
        turnsDenyPending={turnsDeny.isPending}
        cleanupWorktreePending={cleanupWorktree.isPending}
        budgetExtendError={budgetExtend.isError ? budgetExtend.error : null}
        budgetDenyError={budgetDeny.isError ? budgetDeny.error : null}
        turnsExtendError={turnsExtend.isError ? turnsExtend.error : null}
        turnsDenyError={turnsDeny.isError ? turnsDeny.error : null}
        cleanupWorktreeError={cleanupWorktree.isError ? cleanupWorktree.error : null}
        cleanupWorktreeResult={cleanupWorktree.data}
        onBudgetExtend={(input) => budgetExtend.mutate(input)}
        onBudgetDeny={(input) => budgetDeny.mutate(input)}
        onTurnsExtend={(input) => turnsExtend.mutate(input)}
        onTurnsDeny={(input) => turnsDeny.mutate(input)}
        onCleanupWorktree={(inputRunId) => cleanupWorktree.mutate(inputRunId)}
      />
      <LegacyAttemptBanner snapshot={attempt?.snapshot} />
      <RunStatusSummaries
        run={run}
        activity={activity}
        siblingRuns={siblingRuns}
        project={project}
        spec={spec}
        task={task}
        nextTaskHref={nextTaskHref(specTasks, task, project?.name, spec?.name)}
        isFailing={isFailing}
        needsApproval={needsApproval}
        isDone={status.kind === 'done'}
      />
      <RunStatsStrip run={run} agent={agent} />
      <RunLinksCard run={run} />
      <RunSignalGrid run={run} gates={gates} activity={activity} />
      {showDiffCard && (
        <RunDiffCard
          diff={diff}
          diffLoading={diffLoading}
          diffError={diffError}
          title={diffCardTitle}
          unavailableReason={diffUnavailable}
        />
      )}
      {needsApproval && (
        <RunApprovalCard
          run={run}
        />
      )}
      <RunDetailTabs
        activity={activity}
        evidence={evidence}
        transitions={transitions}
        gates={gates}
        decisions={decisions}
        updates={updates}
        sseStatus={sse.status}
      />
    </div>
  )
}

function isStaleApproval(run: { pendingApproval?: boolean | null; failReason?: string | null }): boolean {
  return run.pendingApproval === true && /stale approval/i.test(run.failReason ?? '')
}

function runHeroSummary(run: RunType): string {
  if (run.completionSummary != null && run.completionSummary.trim() !== '') {
    const review = parseReviewResultSummary(run.completionSummary)
    if (review != null) {
      return review.summary == null ? `${review.verdict} review result` : `${review.verdict} review result: ${review.summary}`
    }
    return run.completionSummary
  }
  return run.blockedReason ?? run.failReason ?? ''
}

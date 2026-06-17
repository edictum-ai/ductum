import { useNavigate, useParams } from 'react-router-dom'

import {
  useAgents, useApproveRun, useCancelRun, useDecisions, useRejectRun, useResolveRun, useRetryRun,
  useRunActivity, useRunDiff, useRunEvidence, useRunGateEvals, useRunHistory, useRunUpdates,
  useRuns, useTasks,
} from '@/api/hooks'
import { useDuctumSSE } from '@/api/sse'
import { statusOf, tokens, toneColor } from '@/components/signal'
import { isAwaitingApproval } from '@/lib/derived-status'
import { RunDetailTabs } from './run-detail/detail-tabs'
import { RunCancelCard } from './run-detail/cancel-card'
import { RunDetailHero } from './run-detail/hero'
import {
  RunApprovalCard,
  RunDiffCard,
  RunSignalGrid,
  RunStatsStrip,
  RunStatusSummaries,
} from './run-detail/overview-panels'
import { enc } from './run-detail/transcript'
import type { TaskType } from './run-detail/types'

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
  const shouldLoadDiff = run != null && isAwaitingApproval(run)

  useDuctumSSE({ runId })

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
  })
  const approveRun = useApproveRun()
  const rejectRun = useRejectRun()
  const retryRun = useRetryRun()
  const cancelRun = useCancelRun()

  if (!run) {
    return (
      <div style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }}>
        <div className="shimmer" style={{ height: 240, borderRadius: 10, border: `1px solid ${tokens.hair}`, background: tokens.canvas }} />
      </div>
    )
  }

  const agent = agents.find((a) => a.id === run.agentId)
  const status = statusOf(run)
  const running = status.kind === 'running' || status.kind === 'fixing' || status.kind === 'reviewing' || status.kind === 'watching'
  const needsApproval = status.kind === 'approval'
  const isFailing = status.kind === 'failed' || status.kind === 'stalled'
  const canCancel = run.terminalState == null && run.stage !== 'done'
  const canRetry = isFailing && run.recoverable !== false
  const taskTitle = task?.name ?? run.id
  const summaryText = run.completionSummary ?? run.blockedReason ?? run.failReason ?? ''

  function retryToTask() {
    if (!project || !spec || !task) return
    retryRun.mutate(runId, {
      onSuccess: () => navigate(`/${enc(project.name)}/${enc(spec.name)}/${enc(task.name)}`),
    })
  }

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
        needsApproval={needsApproval}
        canRetry={canRetry && project != null && spec != null && task != null}
        approvePending={approveRun.isPending}
        retryPending={retryRun.isPending}
        activity={activity}
        onApprove={() => approveRun.mutate(runId)}
        onRetry={retryToTask}
      />
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
      {canCancel && (
        <RunCancelCard
          run={run}
          isPending={cancelRun.isPending}
          error={cancelRun.isError ? cancelRun.error : null}
          onCancel={(input) => cancelRun.mutate(input)}
        />
      )}
      <RunStatsStrip run={run} agent={agent} />
      <RunSignalGrid run={run} gates={gates} activity={activity} />
      {needsApproval && <RunDiffCard diff={diff} diffLoading={diffLoading} diffError={diffError} />}
      {needsApproval && (
        <RunApprovalCard
          run={run}
          approvePending={approveRun.isPending}
          approveError={approveRun.isError ? approveRun.error : null}
          rejectPending={rejectRun.isPending}
          onApprove={() => approveRun.mutate(runId)}
          onReject={(id, reason) => rejectRun.mutate({ runId: id, reason })}
        />
      )}
      <RunDetailTabs
        activity={activity}
        evidence={evidence}
        transitions={transitions}
        gates={gates}
        decisions={decisions}
        updates={updates}
      />
    </div>
  )
}

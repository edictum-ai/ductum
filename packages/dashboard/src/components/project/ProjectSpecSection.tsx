import { FolderOpen } from 'lucide-react'
import { useState, type ElementType } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Agent, ExecutionMode, ProjectRun, Repository, Spec, Task } from '@/api/client'
import { SpecBriefPanel } from '@/components/spec/SpecBriefPanel'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { specStatusTone, taskStatusTone } from '@/lib/stage-display'
import { toneBadgeClass } from '@/components/signal'
import { runCost, runDisplayStatus, runStatusLabel } from '@/lib/run-presentation'
import { DISPLAY_STATUS_CLASSES } from '@/lib/derived-status'
import { executionModeBadgeLabel } from '@/lib/execution-integrity'
import { classifyTaskKind, TASK_KIND_BADGE_CLASSES, type ParsedTaskKind } from '@/lib/task-kind'
import { cn, timeAgo } from '@/lib/utils'
import { shortId } from '@/lib/display'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

const EXECUTION_MODE_CLASSES: Record<ExecutionMode, string> = {
  orchestrated: 'border-emerald-500/40 text-emerald-300',
  external: 'border-sky-500/40 text-sky-300',
  recorded: 'border-amber-500/40 text-amber-300',
  unknown: 'border-border/50 text-muted-foreground',
  inconsistent: 'border-red-500/50 text-red-300',
}

function executionBadge(
  item: Pick<Task | ProjectRun, 'executionMode' | 'executionIssues'>,
  options?: { showUnknown?: boolean },
): {
  label: string
  classes: string
} | null {
  const mode = item.executionMode
  if (mode == null) return null
  if (mode === 'unknown' && options?.showUnknown === false) return null
  return {
    label: executionModeBadgeLabel(item) ?? mode,
    classes: EXECUTION_MODE_CLASSES[mode],
  }
}

export function SpecSection({ spec, tasks, specRuns, agents, navigate, projectName, repositories }: {
  spec: Spec
  tasks: Task[]
  specRuns: ProjectRun[]
  agents: Agent[]
  navigate: ReturnType<typeof useNavigate>
  projectName: string
  repositories?: Repository[]
}) {
  const [reviewLoopOpen, setReviewLoopOpen] = useState(false)
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const authoredTasks = tasks.filter((task) => classifyTaskKind(task).kind === 'impl')
  const hasAuthoredTasks = authoredTasks.length > 0
  const visibleTasks = hasAuthoredTasks ? authoredTasks : tasks
  const reviewLoopTasks = hasAuthoredTasks ? tasks.filter((task) => classifyTaskKind(task).kind !== 'impl') : []
  const authoredRuns = specRuns.filter((run) => classifyRunKind(run, taskById).kind === 'impl')
  const reviewLoopRuns = hasAuthoredTasks ? specRuns.filter((run) => classifyRunKind(run, taskById).kind !== 'impl') : []
  const recentRuns = (hasAuthoredTasks ? authoredRuns : specRuns).slice(0, 5)
  const visibleReviewLoopRuns = reviewLoopRuns.slice(0, 5)
  const reviewTaskCount = reviewLoopTasks.filter((task) => classifyTaskKind(task).kind === 'review').length
  const fixTaskCount = reviewLoopTasks.filter((task) => classifyTaskKind(task).kind === 'fix').length
  const reviewLoopStatuses = reviewLoopRuns.map(runDisplayStatus)
  const reviewLoopNeedsAttention = reviewLoopStatuses.some((status) => status === 'failed' || status === 'stalled')
  const reviewLoopActive = reviewLoopStatuses.some((status) => status === 'running' || status === 'awaiting_review' || status === 'awaiting_approval')
  const reviewLoopStateLabel = reviewLoopNeedsAttention ? 'failed/stalled' : reviewLoopActive ? 'active' : 'history'
  const reviewLoopToneClass = reviewLoopNeedsAttention
    ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:text-red-200'
    : reviewLoopActive
      ? 'border-blue-500/40 bg-blue-500/10 text-blue-300 hover:border-blue-500/60 hover:text-blue-200'
      : 'border-border/30 bg-muted/10 text-muted-foreground/70 hover:border-primary/30 hover:bg-accent/40 hover:text-foreground'
  const reviewLoopLabel = `${reviewTaskCount} review · ${fixTaskCount} fix · ${reviewLoopRuns.length} attempt${reviewLoopRuns.length === 1 ? '' : 's'}`

  // Derive spec status from its tasks/runs
  const statusTasks = visibleTasks
  const hasActive = statusTasks.some((t) => t.status === 'active' || t.status === 'in-progress')
  const allDone = statusTasks.length > 0 && statusTasks.every((t) => t.status === 'done')
  const statusRuns = hasAuthoredTasks ? authoredRuns : specRuns
  const hasFailed = statusRuns.some((r) => {
    const status = runDisplayStatus(r)
    return status === 'failed' || status === 'stalled'
  })
  const hasRunning = statusRuns.some((r) => runDisplayStatus(r) === 'running')
  const status = allDone ? 'done' : (hasRunning || hasActive) ? 'implementing' : hasFailed ? 'implementing' : spec.status
  const done = statusTasks.filter((t) => t.status === 'done').length
  const progressLabel = reviewLoopTasks.length > 0 ? 'authored done' : 'tasks done'

  return (
    <Card className="border-border/40 bg-card/60">
      <CardContent className="p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between border-b border-border/20 p-4 text-left transition-colors hover:bg-accent/30"
          onClick={() => navigate(`/${enc(projectName)}/${enc(spec.name)}`)}
        >
          <div className="flex items-center gap-3">
            <h3 className="font-semibold tracking-tight">{spec.name}</h3>
            <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(specStatusTone(status)))}>
              {status}
            </Badge>
            {statusTasks.length > 0 && (
              <span className="font-mono text-[11px] text-muted-foreground/50">
                {done}/{statusTasks.length} {progressLabel}
              </span>
            )}
          </div>
          <FolderOpen className="h-4 w-4 text-muted-foreground/30" />
        </button>

        <div className="border-b border-border/20 p-4">
          <SpecBriefPanel spec={spec} tasks={tasks} projectName={projectName} repositories={repositories} compact />
        </div>

        {tasks.length > 0 && (
          <div className="border-b border-border/20 p-3">
            <div className="flex flex-wrap gap-1.5">
              {visibleTasks.map((task: Task) => (
                <TaskChip
                  key={task.id}
                  task={task}
                  onOpen={() => navigate(`/${enc(projectName)}/${enc(spec.name)}/${enc(task.name)}`)}
                />
              ))}
              {reviewLoopTasks.length > 0 && (
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left font-mono text-[10px] transition-all',
                    reviewLoopToneClass,
                  )}
                  onClick={() => setReviewLoopOpen((value) => !value)}
                  aria-expanded={reviewLoopOpen}
                >
                  {reviewLoopOpen ? 'Hide' : 'Show'} review loop
                  <span className="uppercase tracking-wider">{reviewLoopStateLabel}</span>
                  <span className="text-muted-foreground/40">{reviewLoopLabel}</span>
                </button>
              )}
              {reviewLoopOpen && reviewLoopTasks.map((task: Task) => (
                <TaskChip
                  key={task.id}
                  task={task}
                  showKind
                  onOpen={() => navigate(`/${enc(projectName)}/${enc(spec.name)}/${enc(task.name)}`)}
                />
              ))}
            </div>
          </div>
        )}

        {(recentRuns.length > 0 || (reviewLoopOpen && visibleReviewLoopRuns.length > 0)) && (
          <div className="p-3">
            <div className="space-y-px">
              {recentRuns.map((run: ProjectRun) => (
                <RunRow
                  key={run.id}
                  run={run}
                  task={taskById.get(run.taskId)}
                  agentName={agentMap.get(run.agentId)?.name}
                  onOpen={(task) => navigate(`/${enc(projectName)}/${enc(spec.name)}/${enc(task.name)}/${shortId(run.id)}`)}
                />
              ))}
              {reviewLoopOpen && visibleReviewLoopRuns.length > 0 && (
                <div className="mt-2 border-t border-border/20 pt-2">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/45">
                    Review loop history
                  </div>
                  <div className="space-y-px">
                    {visibleReviewLoopRuns.map((run: ProjectRun) => (
                      <RunRow
                        key={run.id}
                        run={run}
                        task={taskById.get(run.taskId)}
                        agentName={agentMap.get(run.agentId)?.name}
                        showKind
                        onOpen={(task) => navigate(`/${enc(projectName)}/${enc(spec.name)}/${enc(task.name)}/${shortId(run.id)}`)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TaskChip({
  task,
  showKind = false,
  onOpen,
}: {
  task: Task
  showKind?: boolean
  onOpen: () => void
}) {
  const execution = executionBadge(task, { showUnknown: false })
  const kind = classifyTaskKind(task)
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-left transition-all hover:border-primary/30 hover:bg-accent/40"
      onClick={onOpen}
    >
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        task.status === 'done' ? 'bg-emerald-400' :
        task.status === 'active' || task.status === 'in-progress' ? 'live-dot bg-primary' :
        task.status === 'failed' ? 'bg-red-400' :
        task.status === 'blocked' ? 'bg-orange-400' :
        'bg-muted-foreground/30',
      )} />
      {showKind && (
        <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', TASK_KIND_BADGE_CLASSES[kind.kind])}>
          {kind.roleCode}
        </Badge>
      )}
      <span className="text-[12px] font-medium">{task.name}</span>
      <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', toneBadgeClass(taskStatusTone(task.status)))}>
        {task.status}
      </Badge>
      {execution && (
        <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', execution.classes)}>
          {execution.label}
        </Badge>
      )}
    </button>
  )
}

function RunRow({
  run,
  task,
  agentName,
  showKind = false,
  onOpen,
}: {
  run: ProjectRun
  task: Task | undefined
  agentName: string | undefined
  showKind?: boolean
  onOpen: (task: Task) => void
}) {
  const displayStatus = runDisplayStatus(run)
  const cost = runCost(run)
  const isLive = displayStatus === 'running'
  const isBad = displayStatus === 'failed' || displayStatus === 'stalled'
  const kind = task == null ? classifyTaskKind({ name: run.taskName, requiredRole: null }) : classifyTaskKind(task)
  const execution = executionBadge(run)
  return (
    <button
      type="button"
      disabled={task == null}
      className={cn(
        'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left transition-all',
        task == null ? 'cursor-not-allowed opacity-70' : 'hover:bg-accent/40',
      )}
      onClick={() => {
        if (task) onOpen(task)
      }}
    >
      <span className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        isLive ? 'live-dot bg-primary' : isBad ? 'bg-red-400' : 'bg-emerald-400',
      )} />
      {showKind && (
        <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', TASK_KIND_BADGE_CLASSES[kind.kind])}>
          {kind.roleCode}
        </Badge>
      )}
      <Badge variant="outline" className={cn('w-[92px] justify-center border font-mono text-[9px]', DISPLAY_STATUS_CLASSES[displayStatus])}>
        {runStatusLabel(run)}
      </Badge>
      {task && <span className="text-[11px] text-muted-foreground/60">{task.name}</span>}
      <span className="text-[12px] font-medium">{agentName ?? 'Agent'}</span>
      {execution && (
        <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', execution.classes)}>
          {execution.label}
        </Badge>
      )}
      <span className="ml-auto font-mono text-[10px] text-muted-foreground/40">{timeAgo(run.createdAt)}</span>
      {cost.state !== 'pending' && <span className="font-mono text-[10px] text-muted-foreground/40">{cost.label}</span>}
    </button>
  )
}

function classifyRunKind(run: ProjectRun, tasks: Map<string, Task>): ParsedTaskKind {
  const task = tasks.get(run.taskId)
  return task == null ? classifyTaskKind({ name: run.taskName, requiredRole: null }) : classifyTaskKind(task)
}

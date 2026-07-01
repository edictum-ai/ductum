import { CheckCircle2, Eye, GitMerge, Hammer, Wrench, XCircle } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api, type Run, type Task } from '@/api/client'
import { useApproveRun } from '@/api/hooks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DISPLAY_STATUS_CLASSES,
} from '@/lib/derived-status'
import { shortId } from '@/lib/display'
import { displayTaskName } from '@/lib/project-display'
import { runCost, runDisplayStatus, runStatusLabel } from '@/lib/run-presentation'
import { stageLabel, stageTone } from '@/lib/stage-display'
import { toneBadgeClass } from '@/components/signal'
import {
  parseTaskKind,
  TASK_KIND_ACCENT_BORDER,
  TASK_KIND_BADGE_CLASSES,
  TASK_KIND_DESCRIPTION,
  type TaskKind,
} from '@/lib/task-kind'
import { cn, timeAgo } from '@/lib/utils'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

interface Props {
  projectName: string
  specName: string
  tasks: Task[]
}

/**
 * One-screen command center per spec (P8). Shows every task in the
 * spec, all runs grouped by task (impl + reviews + fixes), with
 * inline display status, agent, cost, last activity, and an Approve
 * button on awaiting-approval runs so the user never has to drill
 * five pages deep to ship something.
 */
export function SpecCommandCenter({ projectName, specName, tasks }: Props) {
  const navigate = useNavigate()
  const approveRun = useApproveRun()

  // Fan out one runs query per task. The router fix-loop creates new
  // tasks (review-*, fix-*) under the same spec, so this list grows
  // dynamically as the factory works.
  const runQueries = useQueries({
    queries: tasks.map((t) => ({
      queryKey: ['runs', { taskId: t.id }],
      queryFn: () => api.listRuns(t.id),
      enabled: Boolean(t.id),
      refetchInterval: 5000,
    })),
  })

  // Build a map: lineageRoot → [tasks in lineage] so reviews and
  // fixes nest under the impl task they belong to.
  const lineageMap = new Map<string, Task[]>()
  for (const t of tasks) {
    const { originalName } = parseTaskKind(t.name)
    const list = lineageMap.get(originalName) ?? []
    list.push(t)
    lineageMap.set(originalName, list)
  }

  return (
    <Card className="border-border/40 bg-card/40">
      <CardContent className="space-y-6 p-4">
        {[...lineageMap.entries()].map(([rootName, lineageTasks]) => {
          // Sort: impl first, then by parsed round so review/fix
          // interleave in chronological lineage order.
          const sorted = [...lineageTasks].sort((a, b) => {
            const pa = parseTaskKind(a.name)
            const pb = parseTaskKind(b.name)
            if (pa.round !== pb.round) return pa.round - pb.round
            // Same round: review before fix (round 0 is impl only).
            const order = { impl: 0, review: 1, fix: 2 }
            return order[pa.kind] - order[pb.kind]
          })
          const implTask = sorted.find((t) => parseTaskKind(t.name).kind === 'impl')
          const followups = sorted.filter((t) => parseTaskKind(t.name).kind !== 'impl')
          return (
            <div key={rootName} className="rounded-lg border border-blue-500/20 bg-blue-500/[0.02] p-3">
              {/* Lineage header — the impl task name is the lineage identity */}
              <div className="mb-3 flex items-center gap-2 border-b border-blue-500/15 pb-2">
                <Hammer className="h-3.5 w-3.5 text-blue-400" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-blue-300">{rootName}</span>
                <span className="font-mono text-[10px] text-muted-foreground/50">
                  {followups.length === 0
                    ? 'no reviews yet'
                    : `${followups.filter((t) => parseTaskKind(t.name).kind === 'review').length} review · ${followups.filter((t) => parseTaskKind(t.name).kind === 'fix').length} fix`}
                </span>
              </div>
              <div className="space-y-2">
                {/* Render the impl task first, prominently */}
                {implTask && (
                  <LineageTaskRow
                    task={implTask}
                    runs={runQueries[tasks.findIndex((t) => t.id === implTask.id)]?.data ?? []}
                    projectName={projectName}
                    specName={specName}
                    onNavigate={navigate}
                    onApprove={(runId) => approveRun.mutate(runId)}
                    approving={approveRun.isPending}
                  />
                )}
                {/* Then follow-up reviews and fixes, indented */}
                {followups.map((task) => (
                  <LineageTaskRow
                    key={task.id}
                    task={task}
                    runs={runQueries[tasks.findIndex((t) => t.id === task.id)]?.data ?? []}
                    projectName={projectName}
                    specName={specName}
                    onNavigate={navigate}
                    onApprove={(runId) => approveRun.mutate(runId)}
                    approving={approveRun.isPending}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

const KIND_ICON = {
  impl: Hammer,
  review: Eye,
  fix: Wrench,
} as const

/**
 * One task within a lineage. Impl tasks render as the primary row
 * (blue outline, Hammer icon, larger text). Review and fix tasks
 * render as indented children with their own icon + color, so the
 * operator can scan a lineage and immediately see what each row is.
 */
function LineageTaskRow({
  task,
  runs,
  projectName,
  specName,
  onNavigate,
  onApprove,
  approving,
}: {
  task: Task
  runs: Run[]
  projectName: string
  specName: string
  onNavigate: (path: string) => void
  onApprove: (runId: string) => void
  approving: boolean
}) {
  const parsed = parseTaskKind(task.name)
  const isImpl = parsed.kind === 'impl'
  const Icon = KIND_ICON[parsed.kind]
  const taskLabel = displayTaskName(task)

  return (
    <div
      className={cn(
        'rounded-md border-l-2 bg-muted/10 p-2.5',
        TASK_KIND_ACCENT_BORDER[parsed.kind],
        isImpl
          ? 'border border-border/40'
          : 'ml-5 border-y border-r border-border/20',
      )}
      title={TASK_KIND_DESCRIPTION[parsed.kind]}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className={cn('h-3 w-3', {
          impl: 'text-blue-400',
          review: 'text-purple-400',
          fix: 'text-amber-400',
        }[parsed.kind])} />
        <Badge
          variant="outline"
          className={cn('border font-mono text-[9px] uppercase', TASK_KIND_BADGE_CLASSES[parsed.kind])}
        >
          {parsed.roleCode}
        </Badge>
        <span className={cn('font-mono text-[11px]', isImpl ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}>
          {isImpl ? taskLabel : parsed.roleLabel}
        </span>
        <Badge variant="outline" className="border-border/40 font-mono text-[9px] text-muted-foreground">
          {task.status}
        </Badge>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
          {runs.length} attempt{runs.length === 1 ? '' : 's'}
        </span>
      </div>
      {runs.length === 0 ? (
        <p className="ml-5 text-[11px] text-muted-foreground/60">No attempts yet</p>
      ) : (
        <div className="ml-5 space-y-1">
          {runs.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              projectName={projectName}
              specName={specName}
              taskName={task.name}
              onNavigate={onNavigate}
              onApprove={onApprove}
              approving={approving}
              kind={parsed.kind}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RunRow({
  run,
  projectName,
  specName,
  taskName,
  onNavigate,
  onApprove,
  approving,
  kind,
}: {
  run: Run
  projectName: string
  specName: string
  taskName: string
  onNavigate: (path: string) => void
  onApprove: (runId: string) => void
  approving: boolean
  kind: TaskKind
}) {
  const status = runDisplayStatus(run)
  const url = `/${enc(projectName)}/${enc(specName)}/${enc(taskName)}/${shortId(run.id)}`
  const isAwaiting = status === 'awaiting_approval'

  // Suppress the kind-noise parameter — we currently use it for a
  // subtle accent dot on the run row so impl runs look distinct from
  // review runs when multiple lineage tasks are on screen.
  const kindDotColor = {
    impl: 'bg-blue-400/60',
    review: 'bg-purple-400/60',
    fix: 'bg-amber-400/60',
  }[kind]

  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', kindDotColor)} aria-hidden />
      <Badge variant="outline" className={cn('border font-mono text-[9px]', DISPLAY_STATUS_CLASSES[status])}>
        {runStatusLabel(run)}
      </Badge>
      <Badge variant="outline" className={cn('border font-mono text-[9px]', toneBadgeClass(stageTone(run.stage)))}>
        {stageLabel(run.stage)}
      </Badge>
      <button
        type="button"
        className="flex-1 truncate text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => onNavigate(url)}
        title={run.id}
      >
        {shortId(run.id)} · {timeAgo(run.lastHeartbeat ?? run.updatedAt)}
      </button>
      <span className="font-mono text-[10px] text-muted-foreground/70">{runCost(run).label}</span>
      {isAwaiting && (
        <Button
          size="sm"
          className="h-6 bg-emerald-600 px-2 text-[10px] hover:bg-emerald-700"
          disabled={approving}
          onClick={(e) => {
            e.stopPropagation()
            onApprove(run.id)
          }}
        >
          <GitMerge className="mr-1 h-3 w-3" />
          Approve & merge
        </Button>
      )}
      {run.terminalState === 'failed' && <XCircle className="h-3 w-3 text-red-500" />}
      {run.stage === 'done' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
    </div>
  )
}

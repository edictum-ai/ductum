import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  DollarSign,
  ListTodo,
  Zap,
} from 'lucide-react'
import type { ElementType } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Agent, EnrichedRun, ProjectRun, Spec, Task } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { RunSection } from '@/components/homepage/RunFeed'
import { SpecSection } from './ProjectSpecSection'
import { taskStatusTone } from '@/lib/stage-display'
import { toneBadgeClass } from '@/components/signal'
import { runCost, runDisplayStatus, runHref, runNeedsAttention, runsCostLabel } from '@/lib/run-presentation'
import { cn } from '@/lib/utils'
import { shortId } from '@/lib/display'

/** Encode a name for use in a slug-based URL segment. */
function enc(segment: string): string {
  return encodeURIComponent(segment)
}

/* ──────────────────────────────────────────────
   Summary cards (spend, counts)
   ────────────────────────────────────────────── */

interface SummaryCardProps {
  icon: ElementType
  label: string
  value: string | number
  sub?: string
  variant?: 'default' | 'danger' | 'warn' | 'success'
}

function SummaryCard({ icon: Icon, label, value, sub, variant = 'default' }: SummaryCardProps) {
  const iconClass =
    variant === 'danger' ? 'text-red-400'
    : variant === 'warn' ? 'text-amber-400'
    : variant === 'success' ? 'text-emerald-400'
    : 'text-primary'
  return (
    <Card className="border-border/40 bg-card/60">
      <CardContent className="flex items-start gap-3 p-4">
        <div className={cn('mt-0.5 rounded-md bg-muted p-2', iconClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="font-mono text-2xl font-bold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {sub && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

/** Spend + run-count summary bar at the top of the project page. */
export function ProjectSummaryBar({ runs }: { runs: ProjectRun[] }) {
  const activeCount = runs.filter((r) => runDisplayStatus(r) === 'running').length
  const attentionCount = runs.filter((r) => runNeedsAttention(r)).length
  const doneCount = runs.filter((r) => r.stage === 'done').length

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <SummaryCard label="Active attempts" value={activeCount} icon={Zap} />
      <SummaryCard
        label="Needs attention"
        value={attentionCount}
        icon={AlertTriangle}
        variant={attentionCount > 0 ? 'danger' : 'default'}
      />
      <SummaryCard label="Completed" value={doneCount} icon={CheckCircle2} variant="success" />
      <SummaryCard label="Total spend" value={runsCostLabel(runs)} icon={DollarSign} />
      <SummaryCard label="Total attempts" value={runs.length} icon={ListTodo} />
    </div>
  )
}

/* ──────────────────────────────────────────────
   Agent status per project
   ────────────────────────────────────────────── */

/** Single agent card showing busy/idle status and project spend. */
function AgentStatusCard({ agent, projectRuns, navigate, projectName }: {
  agent: Agent
  projectRuns: ProjectRun[]
  navigate: ReturnType<typeof useNavigate>
  projectName: string
}) {
  const agentRuns = projectRuns.filter((r) => r.agentId === agent.id)
  const activeRun = agentRuns.find((r) => runDisplayStatus(r) === 'running')
  const spend = runsCostLabel(agentRuns)
  const isBusy = activeRun != null

  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all',
        isBusy
          ? 'border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10'
          : 'border-border/30 bg-muted/20 hover:border-border/50 hover:bg-accent/40',
      )}
      onClick={() => {
        if (activeRun) {
          navigate(runHref({ ...activeRun, projectName } as EnrichedRun))
        }
      }}
    >
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
        isBusy ? 'bg-primary/10' : 'bg-muted',
      )}>
        <Cpu className={cn('h-4 w-4', isBusy ? 'text-primary' : 'text-muted-foreground/40')} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{agent.name}</span>
          <Badge variant="outline" className="border-border/50 font-mono text-[9px] text-muted-foreground">
            {agent.model}
          </Badge>
        </div>
        <p className={cn(
          'mt-0.5 text-[11px]',
          isBusy ? 'text-primary font-medium' : 'text-muted-foreground/60',
        )}>
          {isBusy ? `working on ${activeRun.taskName}` : 'idle'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[11px]">{spend}</p>
        <p className="text-[10px] text-muted-foreground/70">spend</p>
      </div>
    </button>
  )
}

/** Agents section showing assigned agents with busy/idle status and spend. */
export function AgentStatusSection({
  agents,
  projectAgents,
  projectRuns,
  navigate,
  projectName,
}: {
  agents: Agent[]
  projectAgents: { agentId: string; role: string }[]
  projectRuns: ProjectRun[]
  navigate: ReturnType<typeof useNavigate>
  projectName: string
}) {
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  if (projectAgents.length === 0) return null

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        <Cpu className="h-3 w-3" />
        Agents
        <span className="text-muted-foreground/50">({projectAgents.length})</span>
      </h3>
      <div className="space-y-2">
        {projectAgents.map((pa) => {
          const agent = agentMap.get(pa.agentId)
          if (!agent) return null
          return (
            <AgentStatusCard
              key={pa.agentId}
              agent={agent}
              projectRuns={projectRuns}
              navigate={navigate}
              projectName={projectName}
            />
          )
        })}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Queued tasks (ready, waiting for dispatch)
   ────────────────────────────────────────────── */

export function QueuedTasksSection({
  allTasks,
  navigate,
  projectName,
  specs,
}: {
  allTasks: Task[]
  navigate: ReturnType<typeof useNavigate>
  projectName: string
  specs: Spec[]
}) {
  const queued = allTasks.filter((t) => t.status === 'ready')
  const specById = new Map(specs.map((spec) => [spec.id, spec]))

  if (queued.length === 0) return null

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
        <Clock className="h-3 w-3" />
        Queued
        <span className="text-muted-foreground/50">({queued.length})</span>
      </h3>
      <div className="space-y-1.5">
        {queued.map((task) => {
          const spec = specById.get(task.specId)
          const canOpen = spec != null
          return (
            <button
              key={task.id}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-md border border-border/30 bg-muted/20 px-3 py-2 text-left transition-all hover:border-amber-400/40 hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!canOpen}
              onClick={() => {
                if (spec == null) return
                navigate(`/${enc(projectName)}/${enc(spec.name)}/${enc(task.name)}`)
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <span className="text-[12px] font-medium">{task.name}</span>
              <Badge variant="outline" className={cn('border font-mono text-[9px] py-0', toneBadgeClass(taskStatusTone(task.status)))}>
                {task.status}
              </Badge>
              {task.requiredRole && (
                <span className="font-mono text-[9px] text-muted-foreground/50">needs: {task.requiredRole}</span>
              )}
              {!canOpen && (
                <span className="font-mono text-[9px] text-muted-foreground/50">missing spec</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Convert ProjectRun[] into EnrichedRun[] so we can
   reuse RunRow / RunSection from RunFeed.
   ────────────────────────────────────────────── */

export function toEnrichedRuns(runs: ProjectRun[]): EnrichedRun[] {
  return runs.map((r) => ({
    ...(r as ProjectRun & { executionMode?: string; executionIssues?: Array<{ code: string; message: string }> }),
    id: r.id,
    taskId: r.taskId,
    agentId: r.agentId,
    parentRunId: null,
    stage: r.stage as EnrichedRun['stage'],
    terminalState: r.terminalState,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: r.pendingApproval,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: r.failReason,
    recoverable: true,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd,
    lastHeartbeat: r.lastHeartbeat,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    taskName: r.taskName,
    specName: r.specName,
    projectName: '',
    agentName: r.agentName,
    agentModel: r.agentModel,
    retryCount: r.retryCount,
    ui: r.ui,
  }))
}

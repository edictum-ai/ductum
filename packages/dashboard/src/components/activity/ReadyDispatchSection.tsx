import { useQueries } from '@tanstack/react-query'
import { ListChecks, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  api,
  type Agent,
  type EnrichedRun,
  type Project,
  type ProjectAgent,
  type Run,
  type Spec,
  type Task,
} from '@/api/client'
import { useAgents, useDispatchTask, useProjects } from '@/api/hooks'
import { Btn, Mono, tokens } from '@/components/signal'
import { Badge } from '@/components/ui/badge'
import { shortId } from '@/lib/display'
import { cn, timeAgo } from '@/lib/utils'

const READY_LIMIT = 5

interface ReadyDispatchRow {
  task: Task
  spec: Spec
  project: Project
  candidates: Agent[]
  blockedByOpenAttempt: boolean
}

function enc(value: string): string {
  return encodeURIComponent(value)
}

export function ReadyDispatchSection({
  reportedCount,
  attempts,
}: {
  reportedCount: number
  attempts: EnrichedRun[]
}) {
  const navigate = useNavigate()
  const dispatch = useDispatchTask()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const [agentByTask, setAgentByTask] = useState<Record<string, string>>({})

  const specQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['specs', { projectId: project.id }],
      queryFn: () => api.listSpecs(project.id),
      enabled: !!project.id,
    })),
  })
  const taskQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['projects', project.id, 'tasks'],
      queryFn: () => api.getProjectTasks(project.id),
      enabled: !!project.id,
    })),
  })
  const projectAgentQueries = useQueries({
    queries: (projects ?? []).map((project) => ({
      queryKey: ['projects', project.id, 'agents'],
      queryFn: () => api.getProjectAgents(project.id),
      enabled: !!project.id,
    })),
  })

  const rows = useMemo(
    () => buildReadyRows({
      projects: projects ?? [],
      specsByProject: specQueries.map((query) => query.data ?? []),
      tasksByProject: taskQueries.map((query) => query.data ?? []),
      projectAgentsByProject: projectAgentQueries.map((query) => query.data ?? []),
      agents: agents ?? [],
      attempts,
    }),
    [agents, attempts, projectAgentQueries, projects, specQueries, taskQueries],
  )
  const visibleRows = rows.slice(0, READY_LIMIT)
  const hiddenCount = Math.max(0, rows.length - visibleRows.length)
  const loading = projectsLoading || agentsLoading
    || specQueries.some((query) => query.isLoading)
    || taskQueries.some((query) => query.isLoading)
    || projectAgentQueries.some((query) => query.isLoading)
  const visibleDispatchable = rows.filter((row) => row.candidates.length > 0 && !row.blockedByOpenAttempt).length

  function openRun(row: ReadyDispatchRow, run: Run) {
    navigate(`/${enc(row.project.name)}/${enc(row.spec.name)}/${enc(row.task.name)}/${enc(shortId(run.id))}`)
  }

  return (
    <section className="rounded-lg border border-border/40 bg-card/60">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        <ListChecks className="h-4 w-4 text-cyan-300" />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-cyan-300">
          Ready to dispatch
        </h2>
        <Badge variant="outline" className="ml-1 border-border/50 font-mono text-[10px] text-muted-foreground">
          {reportedCount}
        </Badge>
        {visibleDispatchable > 0 && (
          <Mono size={11} color={tokens.dim}>{visibleDispatchable} actionable</Mono>
        )}
      </div>
      {loading ? (
        <div className="p-4"><div className="shimmer h-16 rounded-md" /></div>
      ) : visibleRows.length > 0 ? (
        <div className="divide-y divide-border/30">
          {visibleRows.map((row) => {
            const selectedAgentId = agentByTask[row.task.id] ?? row.task.assignedAgentId ?? row.candidates[0]?.id ?? ''
            const selected = row.candidates.find((agent) => agent.id === selectedAgentId) ?? row.candidates[0] ?? null
            const canStart = selected != null && !row.blockedByOpenAttempt && !dispatch.isPending
            return (
              <div key={row.task.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold tracking-normal">{row.task.name}</span>
                    <Badge variant="outline" className="border-cyan-500/40 font-mono text-[10px] text-cyan-300">
                      ready
                    </Badge>
                    {row.task.requiredRole && (
                      <Badge variant="outline" className="border-border/50 font-mono text-[10px] text-muted-foreground">
                        {row.task.requiredRole}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">{row.project.name} / {row.spec.name}</span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{timeAgo(row.task.updatedAt)}</span>
                  </div>
                  <p className={cn('mt-1 text-xs', canStart ? 'text-cyan-200/80' : 'text-amber-300/85')}>
                    {nextActionText(row)}
                  </p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
                  {row.candidates.length > 0 && (
                    <select
                      aria-label={`Agent for ${row.task.name}`}
                      value={selected?.id ?? ''}
                      onChange={(event) => setAgentByTask((current) => ({ ...current, [row.task.id]: event.target.value }))}
                      className="h-8 min-w-0 rounded-md border border-border/50 bg-background px-2 font-mono text-[11px] text-foreground"
                    >
                      {row.candidates.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name} · {agent.model}</option>
                      ))}
                    </select>
                  )}
                  <Btn
                    primary
                    small
                    disabled={!canStart}
                    title={canStart ? 'Start attempt' : nextActionText(row)}
                    onClick={() => {
                      if (selected == null || row.blockedByOpenAttempt) return
                      dispatch.mutate({ taskId: row.task.id, agentId: selected.id }, { onSuccess: (run) => openRun(row, run) })
                    }}
                    data-testid={`ready-dispatch-start-${row.task.id}`}
                  >
                    <span className="inline-flex items-center gap-1"><Play className="h-3 w-3" />Start</span>
                  </Btn>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          {reportedCount > 0
            ? `Operator brief reports ${reportedCount} ready task${reportedCount === 1 ? '' : 's'}, but project task details are not visible here yet.`
            : 'No ready tasks are waiting to dispatch.'}
        </p>
      )}
      {hiddenCount > 0 && (
        <div className="border-t border-border/40 px-4 py-3 font-mono text-[11px] text-muted-foreground">
          Showing {visibleRows.length} of {rows.length} ready tasks. Open the project page for the rest.
        </div>
      )}
      {dispatch.error instanceof Error && (
        <div className="border-t border-border/40 px-4 py-3 text-xs text-red-300">{dispatch.error.message}</div>
      )}
    </section>
  )
}

function buildReadyRows(input: {
  projects: Project[]
  specsByProject: Spec[][]
  tasksByProject: Task[][]
  projectAgentsByProject: ProjectAgent[][]
  agents: Agent[]
  attempts: EnrichedRun[]
}): ReadyDispatchRow[] {
  const agentById = new Map(input.agents.map((agent) => [agent.id, agent]))
  const openTaskIds = new Set(input.attempts
    .filter((attempt) => attempt.stage !== 'done' && attempt.terminalState == null)
    .map((attempt) => attempt.taskId))

  return input.projects.flatMap((project, index) => {
    const specById = new Map((input.specsByProject[index] ?? []).map((spec) => [spec.id, spec]))
    const projectAgents = input.projectAgentsByProject[index] ?? []
    return (input.tasksByProject[index] ?? [])
      .filter((task) => task.status === 'ready')
      .map((task) => {
        const spec = specById.get(task.specId)
        if (spec == null) return null
        return {
          task,
          spec,
          project,
          candidates: dispatchCandidates(agentById, projectAgents, task),
          blockedByOpenAttempt: openTaskIds.has(task.id),
        }
      })
      .filter((row): row is ReadyDispatchRow => row != null)
  }).sort((a, b) => Date.parse(b.task.updatedAt) - Date.parse(a.task.updatedAt) || a.task.name.localeCompare(b.task.name))
}

function dispatchCandidates(agentById: Map<string, Agent>, projectAgents: ProjectAgent[], task: Task): Agent[] {
  const role = task.requiredRole ?? 'builder'
  return projectAgents
    .filter((assignment) => assignment.role === role || (task.requiredRole == null && assignment.role === 'builder'))
    .map((assignment) => agentById.get(assignment.agentId))
    .filter((agent): agent is Agent => agent != null)
}

function nextActionText(row: ReadyDispatchRow): string {
  if (row.blockedByOpenAttempt) return 'Unlock: wait for the current open attempt on this task to finish.'
  if (row.candidates.length === 0) {
    const role = row.task.requiredRole ?? 'builder'
    return `Unlock: assign a ${role} agent to ${row.project.name}.`
  }
  const role = row.task.requiredRole ?? 'builder'
  return `Next action: start a ${role} attempt.`
}

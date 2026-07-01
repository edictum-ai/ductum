import { Cpu } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { useNavigate } from 'react-router-dom'

import type { Agent, ProjectRun } from '@/api/client'
import { useAssignProjectAgent, useUnassignProjectAgent } from '@/api/hooks'
import { costCoverageIssues, costCoverageValue, summarizeCostCoverage } from '@/lib/cost-coverage'
import { displayRunTaskName } from '@/lib/project-display'
import { runDisplayStatus, runHref } from '@/lib/run-presentation'
import { cn } from '@/lib/utils'

const ROLES = ['builder', 'reviewer', 'docs', 'watcher'] as const
type ProjectAgentRun = ProjectRun & { projectName: string }

export function ProjectAgentsPanel({
  projectId,
  agents,
  projectAgents,
  projectRuns,
  navigate,
}: {
  projectId: string
  agents: Agent[]
  projectAgents: { agentId: string; role: string }[]
  projectRuns: ProjectAgentRun[]
  navigate: ReturnType<typeof useNavigate>
}) {
  const assign = useAssignProjectAgent()
  const unassign = useUnassignProjectAgent()
  const [agentId, setAgentId] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('builder')
  const dedupedAgents = useMemo(() => {
    const agentMap = new Map(agents.map((a) => [a.id, a]))
    const byId = new Map<string, { agent: Agent; roles: string[] }>()
    for (const pa of projectAgents) {
      const agent = agentMap.get(pa.agentId)
      if (agent == null) continue
      const entry = byId.get(pa.agentId) ?? { agent, roles: [] }
      if (!entry.roles.includes(pa.role)) entry.roles.push(pa.role)
      byId.set(pa.agentId, entry)
    }
    return [...byId.values()]
  }, [agents, projectAgents])
  const selectedAgentId = agentId || agents[0]?.id || ''

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          <Cpu className="h-3 w-3" />
          Agents <span className="text-muted-foreground/40">({dedupedAgents.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="project-agent-id"
            value={selectedAgentId}
            onChange={(event) => setAgentId(event.target.value)}
            className="h-8 rounded-md border border-border/40 bg-muted/30 px-2 font-mono text-[11px]"
            aria-label="agent to assign"
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name} · {agent.model}</option>
            ))}
          </select>
          <select
            name="project-agent-role"
            value={role}
            onChange={(event) => setRole(event.target.value as (typeof ROLES)[number])}
            className="h-8 rounded-md border border-border/40 bg-muted/30 px-2 font-mono text-[11px]"
            aria-label="project agent role"
          >
            {ROLES.map((roleOption) => <option key={roleOption} value={roleOption}>{roleOption}</option>)}
          </select>
          <button
            type="button"
            className="h-8 rounded-md border border-border/50 bg-card/60 px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedAgentId === '' || assign.isPending}
            onClick={() => assign.mutate({ projectId, agentId: selectedAgentId, role })}
          >
            {assign.isPending ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
      {assign.error instanceof Error && (
        <p className="mb-2 px-1 font-mono text-[11px] text-red-300">{assign.error.message}</p>
      )}
      {dedupedAgents.length === 0 && (
        <p className="rounded-lg border border-border/35 bg-card/35 p-4 text-sm text-muted-foreground">
          No agents assigned to this project yet. Assign a builder before dispatching ready tasks.
        </p>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {dedupedAgents.map(({ agent, roles }) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            roles={roles}
            runs={projectRuns.filter((r) => r.agentId === agent.id)}
            navigate={navigate}
            onUnassign={(role) => unassign.mutate({ projectId, agentId: agent.id, role })}
            unassigning={unassign.isPending}
          />
        ))}
      </div>
    </div>
  )
}

function AgentCard({
  agent,
  roles,
  runs,
  navigate,
  onUnassign,
  unassigning,
}: {
  agent: Agent
  roles: string[]
  runs: ProjectAgentRun[]
  navigate: ReturnType<typeof useNavigate>
  onUnassign: (role: string) => void
  unassigning: boolean
}) {
  const liveRun = runs.find((r) => runDisplayStatus(r) === 'running')
  const coverage = summarizeCostCoverage(runs)
  const costIssues = costCoverageIssues(coverage)
  const className = cn(
    'flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors',
    liveRun
      ? 'border-blue-500/30 bg-blue-500/[0.04] hover:bg-blue-500/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
      : 'border-border/35 bg-card/35',
  )
  const content = (
    <>
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          liveRun ? 'bg-blue-500/15 text-blue-300' : 'bg-muted/80 text-muted-foreground/50',
        )}
      >
        <Cpu className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{agent.name}</span>
          <span className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/65">
            {agent.model}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {liveRun ? (
            <span className="truncate text-xs text-blue-300">working on {displayRunTaskName(liveRun)}</span>
          ) : roles.map((role) => (
            <button
              key={role}
              type="button"
              className="rounded border border-border/35 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70 hover:border-red-400/40 hover:text-red-300"
              disabled={unassigning}
              onClick={(event) => {
                event.stopPropagation()
                onUnassign(role)
              }}
              title={`Unassign ${agent.name} as ${role}`}
            >
              {role} ×
            </button>
          ))}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-xs text-foreground">{costCoverageValue(coverage)}</div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground/45">
          {runs.length} attempt{runs.length === 1 ? '' : 's'}
          {costIssues ? ` · ${costIssues}` : ''}
        </div>
      </div>
    </>
  )

  if (liveRun == null) {
    return <article className={className}>{content}</article>
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => navigate(runHref(liveRun))}
      aria-label={`Open active attempt for ${agent.name}`}
    >
      {content}
    </button>
  )
}

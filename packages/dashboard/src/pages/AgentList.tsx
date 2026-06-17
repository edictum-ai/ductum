import { useCallback } from 'react'
import { useQueries } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { api, type Agent, type EnrichedRun } from '@/api/client'
import { useAgents, useAllRuns, useProjects } from '@/api/hooks'
import { AgentCard, EmptyState, RoutingTable, isAgentRunLive } from '@/agents/AgentWorkforce'
import { Caps, Num, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'

function enc(s: string) {
  return encodeURIComponent(s)
}

export function AgentList() {
  const navigate = useNavigate()
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const { data: runs, isLoading: runsLoading } = useAllRuns({ limit: '200' })
  const { data: projects } = useProjects()
  const projectAgentQueries = useQueries({
    queries: (projects ?? []).map((p) => ({
      queryKey: ['projects', p.id, 'agents'],
      queryFn: () => api.getProjectAgents(p.id),
      enabled: !!p.id,
    })),
  })
  const openSettings = useCallback(() => {
    navigate('/settings')
  }, [navigate])
  const openRun = useCallback(
    (run: EnrichedRun) => {
      navigate(`/${enc(run.projectName)}/${enc(run.specName)}/${enc(run.taskName)}/${enc(shortId(run.id))}`)
    },
    [navigate],
  )

  const allRuns: EnrichedRun[] = runs ?? []
  const allAgents: Agent[] = agents ?? []

  // Collect all agent IDs assigned to at least one project.
  const poolAgentIds = new Set(
    projectAgentQueries.flatMap((q) => (q.data ?? []).map((pa) => pa.agentId)),
  )
  // Only show agents that belong to the project pool. If no projects exist yet,
  // fall back to showing all agents so the page is not blank for new factories.
  const displayAgents =
    projects != null && projects.length > 0
      ? allAgents.filter((a) => poolAgentIds.has(a.id))
      : allAgents

  const projectAgentsLoading = projectAgentQueries.some(q => q.isLoading)
  if (agentsLoading || runsLoading || projectAgentsLoading) {
    return (
      <div style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }} className="fade-in">
        <Caps>Workforce</Caps>
        <div className="shimmer" style={{ marginTop: 20, height: 180, borderRadius: 10, border: `1px solid ${tokens.hair}`, background: tokens.canvas }} />
      </div>
    )
  }

  const liveRuns = allRuns.filter(isAgentRunLive).length
  const lowTier = displayAgents.filter((a) => a.costTier <= 10).length

  return (
    <div style={{ padding: '36px 40px 48px', maxWidth: 1280, margin: '0 auto' }} className="fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'end', marginBottom: 28, gap: 16 }}>
        <div>
          <Caps>Workforce</Caps>
          <div style={{ margin: '10px 0 0', display: 'flex', alignItems: 'baseline', gap: 14 }}>
            <Num size={44} color={tokens.strong}>{displayAgents.length}</Num>
            <div style={{ fontSize: 17, fontWeight: 500, color: tokens.strong }}>agents</div>
            <span style={{ color: tokens.dim }}>·</span>
            <div style={{ fontSize: 14, color: tokens.mid }}>
              {liveRuns} live attempt{liveRuns === 1 ? '' : 's'}, {lowTier} low routing tier
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={openSettings}
          style={{
            justifySelf: 'end',
            minHeight: 34,
            padding: '0 14px',
            borderRadius: 7,
            border: `1px solid ${tokens.rule}`,
            background: tokens.raised,
            color: tokens.fg,
            fontFamily: tokens.sans,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Factory Settings
        </button>
      </div>

      {displayAgents.length === 0 ? (
        <EmptyState onConfigure={openSettings} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }}>
            {displayAgents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} runs={allRuns} onOpenRun={openRun} />
            ))}
          </div>
          <RoutingTable agents={displayAgents} onEdit={openSettings} />
        </>
      )}
    </div>
  )
}

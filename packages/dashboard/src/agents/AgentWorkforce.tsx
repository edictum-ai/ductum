import { useMemo, type ReactNode } from 'react'

import type { Agent, EnrichedRun } from '@/api/client'
import { Btn, Caps, Card, CardHeader, Dot, Mono, Num, agentColor, statusOf, toneColor, tokens, usd } from '@/components/signal'
import { runCost, runDisplayStatus } from '@/lib/run-presentation'

interface AgentStats {
  passRate: number
  avgCost: number
  attemptsWeek: number
  active: EnrichedRun[]
  recent: EnrichedRun[]
}

export function isAgentRunLive(run: EnrichedRun): boolean {
  return runDisplayStatus(run) === 'running' || runDisplayStatus(run) === 'awaiting_approval'
}

export function roleOf(agent: Agent): string {
  const caps = agent.capabilities.map((c) => c.toLowerCase())
  if (caps.includes('review')) return 'reviewer'
  if (caps.includes('watch') || agent.harness === 'watcher') return 'watcher'
  if (caps.includes('docs')) return 'docs'
  return 'builder'
}

function statsFor(agentId: string, runs: EnrichedRun[]): AgentStats {
  const mine = runs.filter((r) => r.agentId === agentId)
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const settled = mine.filter((r) => r.terminalState != null || r.stage === 'done')
  const passed = settled.filter((r) => r.stage === 'done' && r.terminalState == null)
  const active = mine.filter(isAgentRunLive)
  const recent = [
    ...active,
    ...mine
      .filter((r) => !active.includes(r))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  ].slice(0, 3)

  return {
    passRate: settled.length === 0 ? 0 : Math.round((passed.length / settled.length) * 100),
    avgCost: mine.length === 0 ? 0 : mine.reduce((acc, r) => acc + runCost(r).usd, 0) / mine.length,
    attemptsWeek: mine.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length,
    active,
    recent,
  }
}

export function AgentCard({
  agent,
  runs,
  onOpenRun,
}: {
  agent: Agent
  runs: EnrichedRun[]
  onOpenRun: (run: EnrichedRun) => void
}) {
  const stats = useMemo(() => statsFor(agent.id, runs), [agent.id, runs])
  const dotColor = agentColor(agent.id)

  return (
    <Card>
      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginBottom: 16 }}>
        <Dot color={dotColor} size={9} pulse={stats.active.length > 0} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: tokens.sans, fontSize: 26, fontWeight: 500, color: tokens.strong, lineHeight: 1 }}>
            {agent.name}
          </div>
          <Mono size={11.5} color={tokens.dim} style={{ marginTop: 4, display: 'block' }}>
            {agent.model} · {roleOf(agent)}
          </Mono>
        </div>
        <Mono size={11} color={stats.active.length > 0 ? tokens.ok : tokens.dim}>
          {stats.active.length > 0 ? `${stats.active.length} live` : 'idle'}
        </Mono>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, paddingBottom: 16, borderBottom: `1px solid ${tokens.hair}` }}>
        <Metric label="Pass rate" value={<><Num size={22}>{stats.passRate}</Num><Mono size={11} color={tokens.dim}>%</Mono></>} />
        <Metric label="Avg cost" value={<Num size={22}>{usd(stats.avgCost)}</Num>} />
        <Metric label="Attempts / week" value={<Num size={22}>{stats.attemptsWeek}</Num>} />
      </div>

      <div style={{ marginTop: 14 }}>
        <Caps style={{ fontSize: 9 }}>Current attempts</Caps>
        <div style={{ marginTop: 8 }}>
          {stats.recent.length === 0 ? (
            <Mono size={12} color={tokens.faint}>no recent attempts</Mono>
          ) : (
            stats.recent.map((run) => <RunRow key={run.id} run={run} onOpen={() => onOpenRun(run)} />)
          )}
        </div>
      </div>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <Caps style={{ fontSize: 9 }}>{label}</Caps>
      <div style={{ marginTop: 6 }}>{value}</div>
    </div>
  )
}

function RunRow({ run, onOpen }: { run: EnrichedRun; onOpen: () => void }) {
  const status = statusOf(run)
  const color = toneColor(status.tone)
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 10,
        width: '100%',
        padding: '8px 0',
        border: 0,
        background: 'transparent',
        cursor: 'pointer',
        alignItems: 'center',
        textAlign: 'left',
      }}
    >
      <Dot color={color} size={6} />
      <Mono size={11.5} color={tokens.fg} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {run.taskName}
      </Mono>
      <Mono size={10.5} color={color}>{status.label.toLowerCase()}</Mono>
    </button>
  )
}

export function EmptyState({ onConfigure }: { onConfigure: () => void }) {
  return (
    <div style={{ display: 'grid', justifyItems: 'center', padding: '72px 0' }}>
      <div style={{
        width: 80,
        height: 80,
        borderRadius: 16,
        border: `1px solid ${tokens.hair}`,
        background: tokens.sunken,
        display: 'grid',
        placeItems: 'center',
        marginBottom: 20,
        fontFamily: tokens.sans,
        fontSize: 38,
        fontWeight: 500,
        color: tokens.mid,
      }}>
        D
      </div>
      <Caps style={{ marginBottom: 10 }}>Workforce</Caps>
      <div style={{ fontFamily: tokens.sans, fontSize: 22, fontWeight: 500, color: tokens.strong, marginBottom: 14 }}>
        No agents registered
      </div>
      <Btn onClick={onConfigure}>Configure agents</Btn>
    </div>
  )
}

export function RoutingTable({ agents, onEdit }: { agents: Agent[]; onEdit: () => void }) {
  return (
    <Card style={{ marginTop: 24 }}>
      <CardHeader title="Routing" meta="capabilities from each Agent record" />
      {agents.map((agent, i) => {
        const color = agentColor(agent.id)
        return (
          <div
            key={agent.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 140px 1fr auto',
              gap: 20,
              padding: '14px 0',
              borderTop: i === 0 ? 'none' : `1px solid ${tokens.hair}`,
              alignItems: 'center',
            }}
          >
            <Mono size={12.5} color={tokens.fg}>{agent.capabilities.join(', ') || 'no capabilities'}</Mono>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Dot color={color} size={7} />
              <span style={{ fontFamily: tokens.sans, fontSize: 13, color: tokens.strong }}>{agent.name}</span>
            </div>
            <div style={{ fontSize: 12.5, color: tokens.mid, lineHeight: 1.5 }}>
              {agent.harness}{agent.effort ? ` · ${agent.effort}` : ''}
            </div>
            <Btn small onClick={onEdit} title="View agent models and routing defaults in Factory Settings.">View</Btn>
          </div>
        )
      })}
    </Card>
  )
}

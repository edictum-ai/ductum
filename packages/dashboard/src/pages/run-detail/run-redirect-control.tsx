import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { Btn, Caps, Card, Mono, tokens } from '@/components/signal'
import type { Agent } from '@/api/client'
import type { RunType } from './types'

interface RedirectInput {
  runId: string
  agentId: string
  reason: string
}

interface RunRedirectControlProps {
  run: RunType
  agents: Agent[]
  canRedirect: boolean
  pending: boolean
  error: unknown
  onRedirect: (input: RedirectInput) => void
}

export function RunRedirectControl({
  run,
  agents,
  canRedirect,
  pending,
  error,
  onRedirect,
}: RunRedirectControlProps) {
  const candidates = useMemo(
    () => agents.filter((agent) => agent.id !== run.agentId),
    [agents, run.agentId],
  )
  const [agentId, setAgentId] = useState(candidates[0]?.id ?? '')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (agentId === '' || !candidates.some((agent) => agent.id === agentId)) {
      setAgentId(candidates[0]?.id ?? '')
    }
  }, [agentId, candidates])

  const selectedAgent = candidates.find((agent) => agent.id === agentId) ?? null
  const trimmedReason = reason.trim()
  const disabled = !canRedirect || pending || selectedAgent == null || trimmedReason === ''
  const command = selectedAgent == null
    ? null
    : `ductum attempt redirect ${run.id} --agent ${selectedAgent.name} --reason <text>`

  function submit() {
    if (disabled || selectedAgent == null) return
    onRedirect({ runId: run.id, agentId: selectedAgent.id, reason: trimmedReason })
  }

  return (
    <Card style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <Caps color={tokens.accent}>Redirect attempt</Caps>
        <Mono size={11} color={tokens.dim}>{run.id}</Mono>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'center' }}>
        <select
          id={`redirect-target-agent-${run.id}`}
          name="redirectTargetAgent"
          aria-label="Redirect target agent"
          value={agentId}
          onChange={(event) => setAgentId(event.currentTarget.value)}
          style={fieldStyle}
        >
          {candidates.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
        <input
          id={`redirect-reason-${run.id}`}
          name="redirectReason"
          aria-label="Redirect reason"
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
          placeholder="operator reason"
          style={fieldStyle}
        />
        <Btn
          disabled={disabled}
          onClick={submit}
          title={!canRedirect ? 'Unlocks while the attempt is still active.' : undefined}
          data-testid="run-control-redirect"
        >
          {pending ? 'Redirecting...' : 'Redirect attempt'}
        </Btn>
      </div>

      {command != null && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 12, lineHeight: 1.55 }}>
          CLI: {command}
        </Mono>
      )}
      {error != null && (
        <Mono color={tokens.err} style={{ display: 'block', marginTop: 10 }}>
          {error instanceof Error ? error.message : 'Redirect failed'}
        </Mono>
      )}
    </Card>
  )
}

const fieldStyle = {
  width: '100%',
  minWidth: 0,
  border: `1px solid ${tokens.rule}`,
  borderRadius: 7,
  background: tokens.sunken,
  color: tokens.fg,
  padding: '8px 10px',
  fontFamily: tokens.sans,
  fontSize: 13,
} satisfies CSSProperties

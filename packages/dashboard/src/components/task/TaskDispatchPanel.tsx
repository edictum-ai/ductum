import { Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { Agent, ProjectAgent, Run, Task } from '@/api/client'
import { useDispatchTask } from '@/api/hooks'
import { Btn, Card, CardHeader, fieldStyle, Mono, tokens } from '@/components/signal'

export function TaskDispatchPanel({
  task,
  agents,
  projectAgents,
  onStarted,
  title = 'Dispatch',
  meta = 'start a new attempt for this ready task',
}: {
  task: Task
  agents: Agent[]
  projectAgents: ProjectAgent[]
  onStarted: (run: Run) => void
  title?: string
  meta?: string
}) {
  const dispatch = useDispatchTask()
  const candidates = useMemo(
    () => dispatchCandidates(agents, projectAgents, task),
    [agents, projectAgents, task],
  )
  const defaultAgentId = task.assignedAgentId != null && candidates.some((agent) => agent.id === task.assignedAgentId)
    ? task.assignedAgentId
    : candidates[0]?.id ?? ''
  const [agentId, setAgentId] = useState(defaultAgentId)
  const selected = candidates.find((agent) => agent.id === agentId) ?? null
  const canStart = task.status === 'ready' && selected != null && !dispatch.isPending

  useEffect(() => {
    if ((agentId === '' || selected == null) && defaultAgentId !== '') setAgentId(defaultAgentId)
  }, [agentId, defaultAgentId, selected])

  if (task.status !== 'ready') {
    return (
      <div data-testid="task-dispatch-panel">
        <Card>
          <CardHeader
            title={title}
            meta={`locked while task is ${task.status}`}
            action={<Play size={15} color={tokens.dim} />}
          />
          <div style={{ display: 'grid', gap: 10 }}>
            <Mono color={tokens.dim}>
              Start attempt appears here when this task reaches ready.
            </Mono>
            <Btn primary disabled title="Task must be ready before dispatch">
              Start attempt
            </Btn>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div data-testid="task-dispatch-panel">
      <Card>
        <CardHeader
          title={title}
          meta={meta}
          action={<Play size={15} color={tokens.accent} />}
        />
        {candidates.length === 0 ? (
          <Mono color={tokens.warn}>
            No project-assigned agents can run this task. Assign a builder or matching role from the project page.
          </Mono>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <Mono size={11} color={tokens.dim}>agent</Mono>
              <select
                value={agentId}
                onChange={(event) => setAgentId(event.target.value)}
                style={fieldStyle}
                data-testid="task-dispatch-agent"
              >
                {candidates.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name} · {agent.model}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Btn
                primary
                disabled={!canStart}
                onClick={() => {
                  if (selected == null) return
                  dispatch.mutate({ taskId: task.id, agentId: selected.id }, { onSuccess: onStarted })
                }}
                data-testid="task-dispatch-start"
              >
                {dispatch.isPending ? 'Starting…' : 'Start attempt'}
              </Btn>
              {dispatch.error instanceof Error && (
                <Mono size={11} color={tokens.err}>{dispatch.error.message}</Mono>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function dispatchCandidates(agents: Agent[], projectAgents: ProjectAgent[], task: Task): Agent[] {
  const role = task.requiredRole ?? 'builder'
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const assigned = projectAgents.filter((assignment) =>
    assignment.role === role || (task.requiredRole == null && assignment.role === 'builder'),
  )
  return assigned
    .map((assignment) => agentById.get(assignment.agentId))
    .filter((agent): agent is Agent => agent != null)
}

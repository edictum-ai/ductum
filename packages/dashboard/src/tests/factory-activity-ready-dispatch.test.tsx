import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { Agent, OperatorBrief, Project, ProjectAgent, Run, Spec, Task } from '@/api/client'
import { FactoryActivity } from '@/pages/FactoryActivity'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('FactoryActivity ready dispatch section', () => {
  it('surfaces ready tasks with next action and agent choice', async () => {
    const now = '2026-06-15T13:00:00.000Z'
    fetchHelper = mockFetch(baseResponses({
      now,
      projectAgents: [{ projectId: 'p1', agentId: 'a1', role: 'builder' }],
      agents: [agent({ id: 'a1', name: 'codex', model: 'gpt-5.4' })],
      tasks: [task({ id: 't1', name: 'P1-ready-dispatch', updatedAt: now })],
      readyTasks: 1,
    }))

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByText('P1-ready-dispatch')).toBeInTheDocument()
    })
    expect(callsOf(fetchHelper!, 'GET', '/api/attempts?limit=500')).toHaveLength(1)
    const section = screen.getByRole('heading', { name: 'Ready to dispatch' }).closest('section') as HTMLElement
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    const readyIndex = headings.indexOf('Ready to dispatch')
    const clearIndex = headings.indexOf('Attention clear')
    expect(readyIndex).toBeGreaterThanOrEqual(0)
    expect(clearIndex).toBeGreaterThanOrEqual(0)
    expect(readyIndex).toBeLessThan(clearIndex)
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(within(section).getByText('P1-ready-dispatch')).toBeInTheDocument()
    expect(within(section).getByText('personal-memory / gateway-foundation')).toBeInTheDocument()
    expect(within(section).getByText('Next action: start a builder attempt.')).toBeInTheDocument()
    expect(within(section).getByLabelText('Agent for P1-ready-dispatch')).toHaveTextContent('codex · gpt-5.4')
    expect(within(section).getByTestId('ready-dispatch-start-t1')).toBeEnabled()
  })

  it('shows the unlock reason when no project agent can dispatch the task', async () => {
    const now = '2026-06-15T13:00:00.000Z'
    fetchHelper = mockFetch(baseResponses({
      now,
      projectAgents: [],
      agents: [agent({ id: 'a1', name: 'codex', model: 'gpt-5.4' })],
      tasks: [task({ id: 't1', name: 'P1-ready-dispatch', requiredRole: 'reviewer', updatedAt: now })],
      readyTasks: 1,
    }))

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByText('Unlock: assign a reviewer agent to personal-memory.')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ready-dispatch-start-t1')).toBeDisabled()
  })

  it('starts a ready task from Factory Activity', async () => {
    const now = '2026-06-15T13:00:00.000Z'
    fetchHelper = mockFetch({
      ...baseResponses({
        now,
        projectAgents: [{ projectId: 'p1', agentId: 'a1', role: 'builder' }],
        agents: [agent({ id: 'a1', name: 'codex', model: 'gpt-5.4' })],
        tasks: [task({ id: 't1', name: 'P1-ready-dispatch', updatedAt: now })],
        readyTasks: 1,
      }),
      'POST /api/runs/dispatch': run({ id: 'run_123456', taskId: 't1', agentId: 'a1', now }),
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByTestId('ready-dispatch-start-t1')).toBeEnabled()
    })
    fireEvent.click(screen.getByTestId('ready-dispatch-start-t1'))

    await waitFor(() => {
      expect(callsOf(fetchHelper!, 'POST', '/api/runs/dispatch')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper!, 'POST', '/api/runs/dispatch')[0]!)).toEqual({
      taskId: 't1',
      agentId: 'a1',
    })
  })

  it('does not show raw ready tasks that are absent from the operator brief ready queue', async () => {
    const now = '2026-06-15T13:00:00.000Z'
    fetchHelper = mockFetch(baseResponses({
      now,
      projectAgents: [{ projectId: 'p1', agentId: 'a1', role: 'builder' }],
      agents: [agent({ id: 'a1', name: 'codex', model: 'gpt-5.4' })],
      tasks: [task({ id: 'stale-ready', name: 'P2-stale-ready', updatedAt: now })],
      readyTasks: 0,
      readyTaskIds: [],
    }))

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByText('No ready tasks are waiting to dispatch.')).toBeInTheDocument()
    })
    expect(screen.queryByText('P2-stale-ready')).not.toBeInTheDocument()
  })
})

function baseResponses(input: {
  now: string
  projectAgents: ProjectAgent[]
  agents: Agent[]
  tasks: Task[]
  readyTasks: number
  readyTaskIds?: string[]
}) {
  return {
    '/api/attempts?limit=500': { attempts: [] },
    '/api/factory/operator-brief': operatorBrief(
      input.readyTasks,
      input.readyTaskIds ?? input.tasks.slice(0, input.readyTasks).map((task) => task.id),
    ),
    '/api/projects': [project(input.now)],
    '/api/agents': input.agents,
    '/api/projects/p1/specs': [spec(input.now)],
    '/api/projects/p1/tasks': input.tasks,
    '/api/projects/p1/agents': input.projectAgents,
  }
}

function operatorBrief(readyTasks: number, readyTaskIds: string[]): OperatorBrief {
  return {
    generatedAt: '2026-06-15T13:00:00.000Z',
    staleSlotsAutoClosed: 0,
    dispatcher: {
      enabled: true,
      running: false,
      activeRuns: 0,
      maxConcurrentRuns: 4,
      lastCycleAt: null,
      adapterCount: 1,
    },
    queue: {
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks,
      readyTaskIds,
      needsOperator: 0,
      integrityIssues: 0,
    },
    integrity: {
      readiness: 'clear',
      issueCount: 0,
      taskIssueCount: 0,
      runIssueCount: 0,
      externalTaskCount: 0,
      externalRunCount: 0,
      taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      issues: [],
      issuesTruncated: false,
    },
    telegram: { enabled: false, configured: false },
    agents: [],
    recommendedActions: [],
  }
}

function project(now: string): Project {
  return {
    id: 'p1',
    factoryId: 'f1',
    name: 'personal-memory',
    repos: ['gateway'],
    config: { mergeMode: 'human', workflowPath: '' },
    createdAt: now,
    updatedAt: now,
  }
}

function spec(now: string): Spec {
  return {
    id: 's1',
    projectId: 'p1',
    name: 'gateway-foundation',
    status: 'approved',
    document: '',
    createdAt: now,
    updatedAt: now,
  }
}

function task(overrides: Partial<Task>): Task {
  const now = '2026-06-15T13:00:00.000Z'
  return {
    id: 't1',
    specId: 's1',
    name: 'ready-task',
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: 'a1',
    name: 'codex',
    model: 'gpt-5.4',
    harness: 'codex-sdk',
    capabilities: ['build'],
    costTier: 80,
    spawnConfig: {},
    createdAt: '2026-06-15T13:00:00.000Z',
    ...overrides,
  }
}

function run(input: { id: string; taskId: string; agentId: string; now: string }): Run {
  return {
    id: input.id,
    taskId: input.taskId,
    agentId: input.agentId,
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: [],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: input.now,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

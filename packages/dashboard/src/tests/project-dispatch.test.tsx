import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ProjectDetail } from '@/pages/ProjectDetail'
import { QueuedTasksSection } from '@/components/project/ProjectControlPanel'
import { TaskDispatchPanel } from '@/components/task/TaskDispatchPanel'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('project dispatch actions', () => {
  it('lets an operator dispatch a ready task from Project detail', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/resolve/personal-memory': {
        project: {
          id: 'p1',
          factoryId: 'f1',
          name: 'personal-memory',
          repos: ['gateway'],
          config: { mergeMode: 'human', workflowPath: '' },
          createdAt: now,
          updatedAt: now,
        },
      },
      '/api/projects/p1/agents': [{ projectId: 'p1', agentId: 'a1', role: 'builder' }],
      '/api/projects/p1/repositories': [],
      '/api/agents': [{
        id: 'a1',
        name: 'codex',
        model: 'gpt-5.5',
        harness: 'codex-sdk',
        capabilities: ['build'],
        costTier: 80,
        spawnConfig: {},
        createdAt: now,
      }],
      '/api/projects/p1/specs': [{
        id: 's1',
        projectId: 'p1',
        name: 'gateway-foundation',
        status: 'draft',
        document: '',
        createdAt: now,
        updatedAt: now,
      }],
      '/api/projects/p1/tasks': [{
        id: 't1',
        specId: 's1',
        name: 'P1-GATEWAY-PHASE-1',
        prompt: '',
        repos: [],
        assignedAgentId: null,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: [],
        createdAt: now,
        updatedAt: now,
      }],
      '/api/projects/p1/runs': [],
      '/api/factory/operator-brief': {
        queue: { readyTasks: 1, readyTaskIds: ['t1'] },
      },
      'POST /api/runs/dispatch': {
        id: 'run1',
        taskId: 't1',
        agentId: 'a1',
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
        lastHeartbeat: now,
        heartbeatTimeoutSeconds: 300,
        completionSummary: null,
        createdAt: now,
        updatedAt: now,
      },
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project" element={<ProjectDetail />} />
        <Route path="/:project/:spec/:task/:run" element={<div>Run detail</div>} />
      </Routes>,
      { route: '/personal-memory' },
    )

    await waitFor(() => {
      expect(screen.getByText('Ready to dispatch')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start attempt' }))

    await waitFor(() => {
      expect(callsOf(fetchHelper!, 'POST', '/api/runs/dispatch')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper!, 'POST', '/api/runs/dispatch')[0]!)).toEqual({
      taskId: 't1',
      agentId: 'a1',
    })
  })

  it('does not show raw ready tasks that are absent from the operator brief ready queue', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/resolve/personal-memory': {
        project: {
          id: 'p1',
          factoryId: 'f1',
          name: 'personal-memory',
          repos: ['gateway'],
          config: { mergeMode: 'human', workflowPath: '' },
          createdAt: now,
          updatedAt: now,
        },
      },
      '/api/projects/p1/agents': [{ projectId: 'p1', agentId: 'a1', role: 'builder' }],
      '/api/projects/p1/repositories': [],
      '/api/agents': [{
        id: 'a1',
        name: 'codex',
        model: 'gpt-5.5',
        harness: 'codex-sdk',
        capabilities: ['build'],
        costTier: 80,
        spawnConfig: {},
        createdAt: now,
      }],
      '/api/projects/p1/specs': [{
        id: 's1',
        projectId: 'p1',
        name: 'gateway-foundation',
        status: 'implementing',
        document: '',
        createdAt: now,
        updatedAt: now,
      }],
      '/api/projects/p1/tasks': [{
        id: 'stale-ready',
        specId: 's1',
        name: 'P2-STALE-READY',
        prompt: '',
        repos: [],
        assignedAgentId: null,
        requiredRole: null,
        complexity: null,
        status: 'ready',
        verification: [],
        createdAt: now,
        updatedAt: now,
      }],
      '/api/projects/p1/runs': [],
      '/api/factory/operator-brief': {
        queue: { readyTasks: 0, readyTaskIds: [] },
      },
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project" element={<ProjectDetail />} />
      </Routes>,
      { route: '/personal-memory' },
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'personal-memory' })).toBeInTheDocument()
    })
    expect(screen.queryByText('Ready to dispatch')).not.toBeInTheDocument()
    expect(screen.queryByText('P2-STALE-READY')).not.toBeInTheDocument()
  })

  it('shows why dispatch is locked before a task is ready', () => {
    const now = new Date().toISOString()
    renderWithProviders(
      <TaskDispatchPanel
        task={{
          id: 't1',
          specId: 's1',
          name: 'P1-GATEWAY-PHASE-1',
          prompt: '',
          repos: [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: null,
          status: 'pending',
          verification: [],
          createdAt: now,
          updatedAt: now,
        }}
        agents={[]}
        projectAgents={[]}
        onStarted={() => undefined}
      />,
    )

    expect(screen.getByText('Start attempt appears here when this task reaches ready.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start attempt' })).toBeDisabled()
  })

  it('opens queued tasks with the project spec slug route', () => {
    const now = new Date().toISOString()
    const navigate = vi.fn()
    renderWithProviders(
      <QueuedTasksSection
        projectName="personal-memory"
        navigate={navigate as never}
        specs={[{
          id: 's1',
          projectId: 'p1',
          name: 'gateway-foundation',
          status: 'approved',
          document: '',
          createdAt: now,
          updatedAt: now,
        }]}
        allTasks={[{
          id: 't1',
          specId: 's1',
          name: 'P1-GATEWAY-PHASE-1',
          prompt: '',
          repos: [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: null,
          status: 'ready',
          verification: [],
          createdAt: now,
          updatedAt: now,
        }]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /P1-GATEWAY-PHASE-1/ }))

    expect(navigate).toHaveBeenCalledWith('/personal-memory/gateway-foundation/P1-GATEWAY-PHASE-1')
  })
})

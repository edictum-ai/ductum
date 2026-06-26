import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { FactoryActivity } from '@/pages/FactoryActivity'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { Projects } from '@/pages/Projects'
import { Settings } from '@/pages/Settings'
import { factorySettingsFixture } from './settings-fixtures'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('P7B dashboard information architecture', () => {
  it('counts project specs and tasks from project records when no attempts exist', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [{
        id: 'p-p7b-counts',
        factoryId: 'f1',
        name: 'edictum',
        repos: ['edictum-ai/edictum', 'edictum-ai/edictum-ts'],
        config: { mergeMode: 'auto', workflowPath: '' },
        createdAt: now,
        updatedAt: now,
      }],
      '/api/runs?limit=500': [],
      '/api/projects/p-p7b-counts/specs': [
        { id: 's1', projectId: 'p-p7b-counts', name: 'P7B', status: 'implementing', document: '', createdAt: now, updatedAt: now },
        { id: 's2', projectId: 'p-p7b-counts', name: 'P7C', status: 'planned', document: '', createdAt: now, updatedAt: now },
      ],
      '/api/projects/p-p7b-counts/tasks': [
        { id: 't1', specId: 's1', name: 'P7B-IA', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: now, updatedAt: now },
        { id: 't2', specId: 's1', name: 'P7B-VERIFY', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'pending', verification: [], createdAt: now, updatedAt: now },
        { id: 't3', specId: 's2', name: 'P7C-REPAIR', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'pending', verification: [], createdAt: now, updatedAt: now },
      ],
    })

    renderWithProviders(<Projects />, { route: '/projects' })

    await waitFor(() => {
      const card = screen.getByText('edictum').closest('a')
      expect(card).not.toBeNull()
      expect(card).toHaveTextContent(/specs\s*2/i)
      expect(card).toHaveTextContent(/tasks\s*3/i)
      expect(card).toHaveTextContent(/attempts\s*0/i)
    })
  })

  it('puts repositories, components, specs, tasks, and attempts under Project detail', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/resolve/ductum': {
        project: {
          id: 'p1',
          factoryId: 'f1',
          name: 'ductum',
          repos: ['edictum-ai/ductum'],
          config: { mergeMode: 'auto', workflowPath: '' },
          createdAt: now,
          updatedAt: now,
        },
      },
      '/api/projects/p1/agents': [],
      '/api/projects/p1/repositories': [{
        id: 'repo1',
        projectId: 'p1',
        name: 'ductum',
        portable: true,
        spec: { localPath: '.', defaultBranch: 'main' },
        readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: true },
        components: [{ id: 'comp1', repositoryId: 'repo1', name: 'cli', spec: { path: 'packages/cli' }, createdAt: now, updatedAt: now }],
      }],
      '/api/agents': [],
      '/api/projects/p1/specs': [{ id: 's1', projectId: 'p1', name: 'P7B', status: 'implementing', document: '', createdAt: now, updatedAt: now }],
      '/api/projects/p1/tasks': [{ id: 't1', specId: 's1', name: 'P7B-IA', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: now, updatedAt: now }],
      '/api/runs?limit=500': [{
        id: 'attempt_1',
        taskId: 't1',
        agentId: 'a1',
        parentRunId: null,
        stage: 'implement',
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
        taskName: 'P7B-IA',
        specName: 'P7B',
        projectName: 'ductum',
        agentName: 'Codex',
        agentModel: 'gpt-5.4',
        retryCount: 0,
      }],
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project" element={<ProjectDetail />} />
      </Routes>,
      { route: '/ductum' },
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'ductum' })).toBeInTheDocument()
    })
    const scope = screen.getByText('Under this project').closest('section')
    expect(scope).not.toBeNull()
    for (const label of ['Repositories', 'Components', 'Specs', 'Tasks', 'Attempts']) {
      expect(within(scope as HTMLElement).getByText(label)).toBeInTheDocument()
    }
  })

  it('keeps Project detail repository metrics aligned with legacy project repos', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/resolve/edictum': {
        project: {
          id: 'p1',
          factoryId: 'f1',
          name: 'edictum',
          repos: ['edictum-ai/edictum', 'edictum-ai/edictum-ts'],
          config: { mergeMode: 'auto', workflowPath: '' },
          createdAt: now,
          updatedAt: now,
        },
      },
      '/api/projects/p1/agents': [],
      '/api/projects/p1/repositories': [],
      '/api/agents': [],
      '/api/projects/p1/specs': [],
      '/api/projects/p1/tasks': [],
      '/api/runs?limit=500': [],
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project" element={<ProjectDetail />} />
      </Routes>,
      { route: '/edictum' },
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'edictum' })).toBeInTheDocument()
    })
    const header = screen.getByRole('heading', { name: 'edictum' }).closest('header')
    expect(header).not.toBeNull()
    expect(within(header as HTMLElement).queryByText(/repositories/i)).not.toBeInTheDocument()

    const scope = screen.getByText('Under this project').closest('section')
    expect(scope).not.toBeNull()
    expect(within(scope as HTMLElement).getByText('Repositories')).toBeInTheDocument()
    expect(within(scope as HTMLElement).getByText('2')).toBeInTheDocument()
    expect(within(scope as HTMLElement).getByText('edictum')).toBeInTheDocument()
    expect(within(scope as HTMLElement).getByText('edictum-ts')).toBeInTheDocument()
  })

  it('puts the dashboard session panel first under Factory Settings', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': factorySettingsFixture(),
    })

    renderWithProviders(<Settings />, { route: '/settings' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory configuration' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '+ Add Agent' })).toBeInTheDocument()
    expect(screen.getByText('Dashboard session')).toBeInTheDocument()
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('factory-settings-summary')).toBeInTheDocument()
    // No YAML editing surface in the interim read-only page.
    expect(screen.queryByText('Advanced catalogs and YAML')).toBeNull()
    expect(screen.queryByTestId('settings-yaml')).toBeNull()
  })

  it('shows read-only factory catalogs without an advanced YAML disclosure', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': factorySettingsFixture(),
    })

    renderWithProviders(<Settings />, { route: '/settings' })

    await waitFor(() => {
      expect(screen.getAllByText(/adapter type/).length).toBeGreaterThan(0)
    })
    expect(screen.getByText('process profiles')).toBeInTheDocument()
    expect(screen.queryByTestId('settings-advanced')).toBeNull()
  })

  it('keeps Factory Activity compact when many attempts need attention', async () => {
    const attempts = Array.from({ length: 10 }, (_, index) => activityAttempt({
      id: `attempt_${index}`,
      taskName: `attention-${index}`,
      updatedAt: `2026-06-08T12:${String(59 - index).padStart(2, '0')}:00.000Z`,
      failReason: `very long failure reason ${index} ${'that should not leak as a full wall of text '.repeat(8)}`,
    }))
    fetchHelper = mockFetch({ '/api/attempts?limit=500': { attempts } })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory Activity' })).toBeInTheDocument()
    })
    expect(screen.getAllByRole('link', { name: /Open attempt attention-/ })).toHaveLength(8)
    expect(screen.getByText('Showing latest 8 of 10 attempts. Use search or project/spec pages for older records.')).toBeInTheDocument()
    expect(screen.queryByText('attention-8')).not.toBeInTheDocument()
    expect(screen.queryByText(/full wall of text full wall of text/)).not.toBeInTheDocument()
  })
})

function activityAttempt(overrides: Partial<EnrichedRun>): EnrichedRun {
  const now = '2026-06-08T13:00:00.000Z'
  return {
    id: 'attempt_0',
    taskId: 'task_0',
    agentId: 'agent_0',
    parentRunId: null,
    stage: 'implement',
    terminalState: 'failed',
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
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
    taskName: 'attention-0',
    specName: 'P7B',
    projectName: 'ductum',
    agentName: 'codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    ...overrides,
  } as EnrichedRun
}

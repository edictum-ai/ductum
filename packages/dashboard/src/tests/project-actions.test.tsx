import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ProjectDetail } from '@/pages/ProjectDetail'
import { Projects } from '@/pages/Projects'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('project operator actions', () => {
  it('creates a project from the Projects page', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [],
      '/api/runs?limit=500': [],
      'POST /api/projects': {
        id: 'p-new',
        factoryId: 'f1',
        name: 'new-project',
        repos: ['/repo/new-project'],
        config: { mergeMode: 'human', workflowPath: '' },
        createdAt: now,
        updatedAt: now,
      },
    })

    renderWithProviders(
      <Routes>
        <Route path="/projects" element={<Projects />} />
        <Route path="/:project" element={<div>Project opened</div>} />
      </Routes>,
      { route: '/projects' },
    )

    fireEvent.click(await screen.findByRole('button', { name: '+ New Project' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'new-project' } })
    fireEvent.change(screen.getByLabelText('Repository local path'), { target: { value: '/repo/new-project' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(callsOf(fetchHelper!, 'POST', '/api/projects')).toHaveLength(1))
    expect(requestBody(callsOf(fetchHelper!, 'POST', '/api/projects')[0]!)).toMatchObject({
      name: 'new-project',
      repository: { name: 'new-project', spec: { localPath: '/repo/new-project' } },
      config: { mergeMode: 'human' },
    })
  })

  it('sorts project cards by operator need and shows cost per clean done attempt', async () => {
    const now = '2026-06-16T12:00:00.000Z'
    const failed = enrichedRun({ projectName: 'blocked-project', stage: 'implement', terminalState: 'failed', costUsd: 2.57 })
    const inconsistent = enrichedRun({
      projectName: 'blocked-project',
      id: 'run_done_blocked',
      stage: 'done',
      terminalState: null,
      costUsd: 20,
      executionMode: 'inconsistent',
      executionIssues: [{ code: 'done_run_without_lineage_or_external_outcome', message: 'Missing lineage.' }],
    })
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p-clear', factoryId: 'f1', name: 'clear-project', repos: ['/repo/clear'], config: { mergeMode: 'human', workflowPath: '' }, createdAt: now, updatedAt: now },
        { id: 'p-blocked', factoryId: 'f1', name: 'blocked-project', repos: ['/repo/blocked'], config: { mergeMode: 'human', workflowPath: '' }, createdAt: now, updatedAt: now },
      ],
      '/api/projects/p-clear/specs': [],
      '/api/projects/p-clear/tasks': [],
      '/api/projects/p-blocked/specs': [],
      '/api/projects/p-blocked/tasks': [],
      '/api/runs?limit=500': [
        enrichedRun({ projectName: 'clear-project', stage: 'done', terminalState: null, costUsd: 20 }),
        failed,
        inconsistent,
      ],
      '/api/factory/operator-brief': operatorBrief([failed, inconsistent]),
    })

    renderWithProviders(
      <Routes>
        <Route path="/projects" element={<Projects />} />
      </Routes>,
      { route: '/projects' },
    )

    expect(await screen.findByText('blocked-project')).toBeInTheDocument()
    const cardNames = Array.from(document.querySelectorAll('a[href^="/"]'))
      .map((element) => element.textContent ?? '')
      .filter((text) => text.includes('-project'))
    expect(cardNames[0]).toContain('blocked-project')
    expect(screen.getByText('2 needs attention')).toBeInTheDocument()
    expect(screen.getByText('$22.57 · no clean done yet')).toBeInTheDocument()
    expect(screen.getByText('$20.00 · $20.00/clean done')).toHaveAttribute('title', 'Clean done means done attempts without execution-integrity issues.')
  })

  it('shows imported specs with no attempts and exposes project actions', async () => {
    fetchHelper = mockFetch(projectDetailResponses())

    renderWithProviders(
      <Routes><Route path="/:project" element={<ProjectDetail />} /></Routes>,
      { route: '/personal-memory' },
    )

    expect(await screen.findByRole('button', { name: /Best-of-N/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New Spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Repository' })).toBeInTheDocument()
    expect(screen.getByText('Project settings')).toBeInTheDocument()
    expect(screen.getByText('gateway-foundation')).toBeInTheDocument()
    expect(screen.getAllByText('P1-GATEWAY-PHASE-1').length).toBeGreaterThan(0)
  })

  it('updates project settings from Project detail', async () => {
    fetchHelper = mockFetch({
      ...projectDetailResponses(),
      'PUT /api/projects/p1': project(),
    })

    renderWithProviders(
      <Routes><Route path="/:project" element={<ProjectDetail />} /></Routes>,
      { route: '/personal-memory' },
    )

    fireEvent.change(await screen.findByTestId('project-name-input'), { target: { value: 'memory' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }))

    await waitFor(() => expect(callsOf(fetchHelper!, 'PUT', '/api/projects/p1')).toHaveLength(1))
    expect(requestBody(callsOf(fetchHelper!, 'PUT', '/api/projects/p1')[0]!)).toMatchObject({
      name: 'memory',
      config: { mergeMode: 'human' },
    })
  })

  it('adds a repository from Project detail', async () => {
    fetchHelper = mockFetch({
      ...projectDetailResponses(),
      'POST /api/projects/p1/repositories': {
        id: 'repo2',
        projectId: 'p1',
        name: 'infra',
        portable: true,
        spec: { localPath: '/repo/infra', defaultBranch: 'main' },
        readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: true },
        components: [],
      },
    })

    renderWithProviders(
      <Routes><Route path="/:project" element={<ProjectDetail />} /></Routes>,
      { route: '/personal-memory' },
    )

    fireEvent.click(await screen.findByRole('button', { name: '+ Repository' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'infra' } })
    fireEvent.change(screen.getByLabelText('Local path'), { target: { value: '/repo/infra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add repository' }))

    await waitFor(() => expect(callsOf(fetchHelper!, 'POST', '/api/projects/p1/repositories')).toHaveLength(1))
    expect(requestBody(callsOf(fetchHelper!, 'POST', '/api/projects/p1/repositories')[0]!)).toMatchObject({
      name: 'infra',
      spec: { localPath: '/repo/infra', defaultBranch: 'main' },
    })
  })
})

function project() {
  const now = '2026-06-14T12:00:00.000Z'
  return {
    id: 'p1',
    factoryId: 'f1',
    name: 'personal-memory',
    repos: ['/repo/gateway'],
    config: { mergeMode: 'human', workflowPath: '' },
    createdAt: now,
    updatedAt: now,
  }
}

function operatorBrief(needsOperatorAttempts: unknown[] = []) {
  return {
    generatedAt: '2026-06-16T12:00:00.000Z',
    dispatcher: { enabled: true, running: true, activeRuns: 0, maxConcurrentRuns: 4, lastCycleAt: nowIso(), adapterCount: 1 },
    queue: {
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks: 0,
      needsOperator: needsOperatorAttempts.length,
      needsOperatorAttempts,
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

function nowIso() {
  return '2026-06-16T12:00:00.000Z'
}

function projectDetailResponses() {
  const now = '2026-06-14T12:00:00.000Z'
  return {
    '/api/resolve/personal-memory': { project: project() },
    '/api/projects/p1/agents': [],
    '/api/projects/p1/repositories': [{
      id: 'repo1',
      projectId: 'p1',
      name: 'gateway',
      portable: true,
      spec: { localPath: '/repo/gateway', defaultBranch: 'main' },
      readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: true },
      components: [],
    }],
    '/api/agents': [],
    '/api/projects/p1/specs': [{
      id: 's1',
      projectId: 'p1',
      name: 'gateway-foundation',
      status: 'approved',
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
    '/api/runs?limit=500': [],
  }
}

function enrichedRun(overrides: Record<string, unknown>) {
  return {
    id: 'run_1',
    taskId: 'task_1',
    taskName: 'P1',
    specName: 'spec',
    projectName: 'project',
    agentId: 'agent_1',
    agentName: 'Agent',
    agentModel: 'model',
    retryCount: 0,
    parentRunId: null,
    stage: 'done',
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
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 1,
    tokensOut: 1,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: '2026-06-16T12:00:00.000Z',
    updatedAt: '2026-06-16T12:00:00.000Z',
    ...overrides,
  }
}

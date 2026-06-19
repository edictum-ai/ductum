import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '@/App'
import type { EnrichedRun } from '@/api/client'
import { mockFetch, renderWithProviders } from './test-utils'

const PROJECT = {
  id: 'p1',
  factoryId: 'f1',
  name: 'ductum',
  repos: [],
  config: { mergeMode: 'squash', workflowPath: '' },
  createdAt: '',
  updatedAt: '',
}

const SPEC = {
  id: 's1',
  projectId: 'p1',
  name: 'impl-005',
  status: 'implementing',
  document: '',
  createdAt: '',
  updatedAt: '',
}

const TASK = {
  id: 't1',
  specId: 's1',
  name: 'P1-TRIAGE',
  prompt: '',
  repos: [],
  assignedAgentId: null,
  requiredRole: null,
  complexity: null,
  status: 'active',
  verification: [],
  createdAt: '',
  updatedAt: '',
}

const RUN = {
  id: 'run_abc123',
  taskId: 't1',
  agentId: 'a1',
  parentRunId: null,
  sessionId: 'sess_1',
  stage: 'implement',
  branch: 'feat/test',
  commitSha: 'abc1234',
  prNumber: 42,
  prUrl: 'https://github.com/test/test/pull/42',
  ciStatus: 'pass',
  reviewStatus: 'pass',
  failReason: null,
  recoverable: true,
  terminalState: null,
  resetCount: 0,
  completedStages: [],
  blockedReason: null,
  pendingApproval: false,
  tokensIn: 100000,
  tokensOut: 15000,
  costUsd: 1.25,
  lastHeartbeat: new Date().toISOString(),
  heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
}

let fetchHelper: ReturnType<typeof mockFetch>
const originalMatchMedia = window.matchMedia

describe('App routes', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
    window.matchMedia = originalMatchMedia
  })

  it('renders the deep run route through the lazy router', async () => {
    mockDesktopViewport()
    fetchHelper = mockFetch({
      '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project: PROJECT, spec: SPEC, task: TASK, run: RUN },
      '/api/tasks/t1/runs': [RUN],
      '/api/runs/run_abc123/evidence': [],
      '/api/runs/run_abc123/history': [],
      '/api/runs/run_abc123/gate-evaluations': [],
      '/api/runs/run_abc123/updates': [],
      '/api/runs/run_abc123/activity': [],
      '/api/decisions': [],
      '/api/agents': [
        {
          id: 'a1',
          name: 'Mimi',
          model: 'claude-opus-4-6',
          harness: 'claude-agent-sdk',
          capabilities: [],
          costTier: 1,
          spawnConfig: {},
          createdAt: '',
        },
      ],
    })

    renderWithProviders(<App />, { route: '/ductum/impl-005/P1-TRIAGE/run_ab' })

    expect(await screen.findByText('Running', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect((await screen.findAllByText('Mimi', {}, { timeout: 20_000 })).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Navigate to Projects' })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: 'Navigate to ductum' })).toHaveAttribute('href', '/ductum')
    expect(screen.getByRole('link', { name: 'Navigate to impl-005' })).toHaveAttribute('href', '/ductum/impl-005')
  })

  it('counts only ship-stage approvals in the sidebar badge', async () => {
    mockDesktopViewport()
    const actionableRun = makeEnrichedRun({
      id: 'run_ship',
      stage: 'ship',
      pendingApproval: true,
      taskName: 'ready-to-merge',
    })
    const staleDoneRun = makeEnrichedRun({
      id: 'run_done_stale',
      stage: 'done',
      terminalState: 'success',
      pendingApproval: true,
      taskName: 'stale-row',
    })

    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [actionableRun],
      '/api/runs?limit=200': [staleDoneRun],
      '/api/runs/run_ship/evidence': [],
      '/api/runs/run_ship/diff': null,
      '/api/runs/run_ship': actionableRun,
      '/api/decisions': [],
    })

    renderWithProviders(<App />, { route: '/approvals' })

    await waitFor(() => {
      const primaryNav = screen.getByRole('navigation', { name: 'Primary' })
      expect(within(primaryNav).getByRole('link', { name: /Approvals/ })).toHaveTextContent('1')
    })
    expect(await screen.findByText('ready-to-merge', {}, { timeout: 20_000 })).toBeInTheDocument()
  })

  it('keeps Settings session controls reachable when the protected dashboard has no browser session', async () => {
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
      '/api/factory-settings': { __status: 401, body: { error: 'Unauthorized' } },
    })

    renderWithProviders(<App />, { route: '/settings#api-access' })

    expect(await screen.findByTestId('token-banner', {}, { timeout: 20_000 })).toHaveTextContent('Reconnect dashboard')
    expect(await screen.findByTestId('operator-session-reconnect', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()
    expect(await screen.findByText('Unauthorized', {}, { timeout: 20_000 })).toBeInTheDocument()
  })
})

function mockDesktopViewport() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('768px'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function makeEnrichedRun(overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    ...RUN,
    taskName: 'P1-TRIAGE',
    specName: 'impl-005',
    projectName: 'ductum',
    agentName: 'Mimi',
    agentModel: 'claude-opus-4-6',
    retryCount: 0,
    ...overrides,
  } as EnrichedRun
}

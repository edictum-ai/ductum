import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { App } from '@/App'
import type { AuditLogEntry } from '@/api/client'
import { AuditLog } from '@/pages/AuditLog'
import { ProjectDetail } from '@/pages/ProjectDetail'
import { RunDetail } from '@/pages/RunDetail'
import { SpecDetail } from '@/pages/SpecDetail'
import { callsOf, mockFetch, renderWithProviders } from './test-utils'

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
  name: 'issue-208-audit-log-bundles',
  status: 'active',
  document: '',
  createdAt: '',
  updatedAt: '',
}

const TASK = {
  id: 't1',
  specId: 's1',
  name: 'P2-AUDIT-LOG-UI',
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
  branch: 'fix/audit-log-ui',
  commitSha: null,
  prNumber: null,
  prUrl: null,
  ciStatus: null,
  reviewStatus: null,
  failReason: null,
  recoverable: true,
  terminalState: null,
  resetCount: 0,
  completedStages: ['understand'],
  blockedReason: null,
  pendingApproval: false,
  tokensIn: 100,
  tokensOut: 10,
  costUsd: 0.01,
  lastHeartbeat: new Date().toISOString(),
  heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
}

const AUDIT_EVENT: AuditLogEntry = {
  id: 'event_1',
  source: 'run_update',
  sourceId: '1',
  occurredAt: '2026-07-02T04:00:00.000Z',
  actor: 'operator',
  projectId: PROJECT.id,
  projectName: PROJECT.name,
  specId: SPEC.id,
  specName: SPEC.name,
  taskId: TASK.id,
  taskName: TASK.name,
  runId: RUN.id,
  eventType: 'run.recovery',
  status: 'recorded',
  title: 'Run update for /Users/acartagena/project/ductum/packages/api/src/routes/audit-log.ts',
  summary: 'operator cancelled no-diff attempt in /Users/acartagena/project/ductum/packages/dashboard/src/pages/AuditLog.tsx',
  metadata: {
    path: '/Users/acartagena/project/ductum/packages/dashboard/src/pages/AuditLog.tsx',
    secretRef: 'secret:github-app',
  },
}

let fetchHelper: ReturnType<typeof mockFetch>
const originalMatchMedia = window.matchMedia

describe('Audit log dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    window.matchMedia = originalMatchMedia
    localStorage.clear()
  })

  it('renders global audit rows with readable target copy and safe metadata', async () => {
    fetchHelper = mockFetch({
      '/api/audit-log': { items: [AUDIT_EVENT], nextCursor: 'cursor-next' },
    })

    renderWithProviders(
      <Routes>
        <Route path="/audit" element={<AuditLog />} />
      </Routes>,
      { route: '/audit' },
    )

    expect(await screen.findByRole('heading', { name: 'Audit Log' })).toBeInTheDocument()
    expect(await screen.findByText('Run update for ductum/packages/api/src/routes/audit-log.ts')).toBeInTheDocument()
    expect(screen.getByText(/operator ·/)).toBeInTheDocument()
    expect(screen.getByText(/ductum \/ issue-208-audit-log-bundles \/ P2-AUDIT-LOG-UI \/ Attempt run_ab/)).toBeInTheDocument()
    expect(screen.getByText('operator cancelled no-diff attempt in ductum/packages/dashboard/src/pages/AuditLog.tsx')).toBeInTheDocument()
    expect(screen.queryByText('/Users/acartagena/project/ductum/packages/api/src/routes/audit-log.ts')).not.toBeInTheDocument()
    expect(screen.queryByText('/Users/acartagena/project/ductum/packages/dashboard/src/pages/AuditLog.tsx')).not.toBeInTheDocument()
    expect(screen.getByText('ductum/packages/dashboard/src/pages/AuditLog.tsx')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeInTheDocument()
  })

  it('backs filters with URL query params and sends them to the API', async () => {
    fetchHelper = mockFetch({
      '/api/audit-log': { items: [], nextCursor: null },
    })

    renderWithProviders(
      <Routes>
        <Route path="/audit" element={<AuditLog />} />
      </Routes>,
      { route: '/audit?runId=run_abc123&eventType=secret.access' },
    )

    await waitFor(() => {
      const firstUrl = String(callsOf(fetchHelper, 'GET', '/api/audit-log')[0]?.[0])
      expect(firstUrl).toContain('runId=run_abc123')
      expect(firstUrl).toContain('eventType=secret.access')
      expect(firstUrl).toContain('limit=50')
    })

    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: 'operator' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      const last = callsOf(fetchHelper, 'GET', '/api/audit-log').at(-1)
      expect(String(last?.[0])).toContain('actor=operator')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Actor')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => {
      const last = callsOf(fetchHelper, 'GET', '/api/audit-log').at(-1)
      expect(String(last?.[0])).not.toContain('actor=operator')
    })
    expect(await screen.findByText('No matching audit events')).toBeInTheDocument()
  })

  it('renders loading and error states explicitly', async () => {
    fetchHelper = mockFetch({
      '/api/audit-log': { __status: 500, body: { error: 'boom' } },
    })

    renderWithProviders(
      <Routes>
        <Route path="/audit" element={<AuditLog />} />
      </Routes>,
      { route: '/audit' },
    )

    expect(screen.getByLabelText('Loading audit log')).toBeInTheDocument()
    expect(await screen.findByText('Audit log could not be loaded.')).toBeInTheDocument()
  })

  it('exposes /audit in the app navigation', async () => {
    mockDesktopViewport()
    fetchHelper = mockFetch({
      '/api/audit-log': { items: [], nextCursor: null },
      '/api/runs?stage=ship': [],
      '/api/factory/activity-summary': null,
      '/api/factory/operator-brief': { queue: { approvalsWaiting: 0, activeRuns: 0, readyTasks: 0, needsOperator: 0, integrityIssues: 0 } },
      '/api/repair': { summary: { total: 0, blockers: 0, attention: 0, byArea: {} }, items: [], groups: [], generatedAt: '' },
    })

    renderWithProviders(<App />, { route: '/audit' })

    expect(await screen.findByRole('heading', { name: 'Audit Log' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Navigate to Factory' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Audit Log/ })).toHaveAttribute('href', '/audit')
  })

  it('adds scoped audit links to project spec and run pages', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/ductum': { project: PROJECT },
      '/api/projects/p1/agents': [],
      '/api/projects/p1/repositories': [],
      '/api/agents': [{ id: 'a1', name: 'glm', model: 'glm-5.2', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
      '/api/projects/p1/specs': [SPEC],
      '/api/projects/p1/tasks': [TASK],
      '/api/projects/p1/runs': [],
      '/api/factory/operator-brief': { queue: { readyTaskIds: [] } },
      '/api/resolve/ductum/issue-208-audit-log-bundles': { project: PROJECT, spec: SPEC },
      '/api/specs/s1/tasks': [TASK],
      '/api/runs?limit=200': [],
      '/api/decisions': [],
      '/api/resolve/ductum/issue-208-audit-log-bundles/P2-AUDIT-LOG-UI/run_ab': { project: PROJECT, spec: SPEC, task: TASK, run: RUN },
      '/api/attempts/run_abc123': { ...RUN, recordType: 'Attempt', name: RUN.id, status: 'running', parentAttemptId: null, snapshot: { completeness: 'full', legacy: false, runtime: {}, missingFields: [] } },
      '/api/tasks/t1/runs': [RUN],
      '/api/runs/run_abc123/evidence': [],
      '/api/runs/run_abc123/history': [],
      '/api/runs/run_abc123/gate-evaluations': [],
      '/api/runs/run_abc123/updates': [],
      '/api/runs/run_abc123/activity': [],
      '/api/runs/run_abc123/secret-access-history': [],
    })

    const routeTree = (
      <Routes>
        <Route path="/:project" element={<ProjectDetail />} />
        <Route path="/:project/:spec" element={<SpecDetail />} />
        <Route path="/:project/:spec/:task/:runId" element={<RunDetail />} />
      </Routes>
    )

    const projectRender = renderWithProviders(routeTree, { route: '/ductum' })
    expect(await screen.findByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/audit?projectId=p1')
    projectRender.unmount()

    const specRender = renderWithProviders(routeTree, { route: '/ductum/issue-208-audit-log-bundles' })
    expect(await screen.findByRole('link', { name: 'Audit log' })).toHaveAttribute('href', '/audit?specId=s1')
    specRender.unmount()

    renderWithProviders(routeTree, { route: '/ductum/issue-208-audit-log-bundles/P2-AUDIT-LOG-UI/run_ab' })
    expect(await screen.findByRole('link', { name: 'Open audit log' })).toHaveAttribute('href', '/audit?runId=run_abc123')
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

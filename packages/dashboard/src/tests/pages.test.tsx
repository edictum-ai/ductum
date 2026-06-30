import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { getHomeUnavailableState, Home } from '@/pages/Home'
import { SpecDetail } from '@/pages/SpecDetail'
import { buildRunSections, RunSection } from '@/components/homepage/RunFeed'
import { SpecSection } from '@/components/project/ProjectSpecSection'
import type { EnrichedRun } from '@/api/client'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

function integritySummary(issueCount = 0, external = 0) {
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      taskCount: 0,
      runCount: 0,
      issueCount,
      taskIssueCount: issueCount,
      runIssueCount: 0,
      taskModes: { orchestrated: 0, external, recorded: 0, unknown: 0, inconsistent: issueCount },
      runModes: { orchestrated: 0, external, recorded: 0, unknown: 0, inconsistent: 0 },
      issues: [],
      issuesTruncated: false,
    },
    tasks: [],
    runs: [],
  }
}

function operatorBrief(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    generatedAt: '2026-04-30T08:00:00.000Z',
    dispatcher: {
      enabled: true,
      running: true,
      activeRuns: 0,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-04-30T07:59:00.000Z',
      adapterCount: 1,
    },
	    queue: {
	      approvalsWaiting: 0,
	      activeRuns: 0,
	      readyTasks: 0,
	      needsOperator: 0,
	      needsOperatorAttempts: [],
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
    ...overrides,
  }
}

function runFixture(overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  const now = '2026-06-19T01:00:00.000Z'
  return {
    id: 'run_demo',
    taskId: 'task1',
    agentId: 'agent1',
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
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
    taskName: 'demo-task',
    specName: 'demo-spec',
    projectName: 'Ductum Core',
    agentName: 'Codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: false,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  }
}

describe('Home', () => {
  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders project cards', async () => {
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: '', updatedAt: '' },
        { id: 'p2', name: 'Edictum TS', repos: ['edictum-ai/edictum-ts'], config: { mergeMode: 'human' }, factoryId: 'f1', createdAt: '', updatedAt: '' },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: '' },
      '/api/factory/operator-brief': operatorBrief(),
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [],
      '/api/agents': [],
    })
    renderWithProviders(<Home />)
    await waitFor(() => {
      expect(screen.getByText('Test · today')).toBeInTheDocument()
      expect(screen.getByText('Active specs')).toBeInTheDocument()
      expect(screen.getByText('Factory idle · no tasks yet · nothing waiting · $0.00/wk')).toBeInTheDocument()
    })
  })

  it('migrates legacy Home last-look state into the durable factory state', async () => {
    const previous = '2026-06-15T10:00:00.000Z'
    localStorage.setItem('ductum.home.lastSeenAt', previous)
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: '', updatedAt: '' },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: '' },
      '/api/factory/operator-brief': operatorBrief(),
      '/api/factory/home-view-state': { factoryId: 'f1', homeLastSeenAt: null, createdAt: null, updatedAt: null },
      'PUT /api/factory/home-view-state': ({ init }: { init?: RequestInit }) => ({
        factoryId: 'f1',
        homeLastSeenAt: requestBody(['', init]).homeLastSeenAt,
        createdAt: '2026-06-15T10:00:00.000Z',
        updatedAt: '2026-06-15T10:00:00.000Z',
      }),
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')[0]!)).toEqual({ homeLastSeenAt: previous })
    expect(localStorage.getItem('ductum.home.lastSeenAt')).toBeNull()
  })

  it('allows Home mark-seen writes after a legacy migration failure', async () => {
    const previous = '2026-06-15T10:00:00.000Z'
    let puts = 0
    localStorage.setItem('ductum.home.lastSeenAt', previous)
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: '', updatedAt: '' },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: '' },
      '/api/factory/operator-brief': operatorBrief(),
      '/api/factory/home-view-state': { factoryId: 'f1', homeLastSeenAt: null, createdAt: null, updatedAt: null },
      'PUT /api/factory/home-view-state': ({ init }: { init?: RequestInit }) => {
        puts += 1
        if (puts === 1) return { __status: 500, body: { error: 'migration failed' } }
        return {
          factoryId: 'f1',
          homeLastSeenAt: requestBody(['', init]).homeLastSeenAt,
          createdAt: '2026-06-15T10:00:00.000Z',
          updatedAt: '2026-06-15T10:00:00.000Z',
        }
      },
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [],
      '/api/agents': [],
    })

    const { unmount } = renderWithProviders(<Home />)
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')).toHaveLength(1)
    })
    unmount()
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')).toHaveLength(2)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')[0]!)).toEqual({ homeLastSeenAt: previous })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/factory/home-view-state')[1]!).homeLastSeenAt).not.toBe(previous)
  })

  it('shows task, queue, and integrity counts in the operator progress surface', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: now, updatedAt: now },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: now },
      '/api/factory/operator-brief': operatorBrief({
        queue: {
          approvalsWaiting: 1,
          activeRuns: 1,
          readyTasks: 1,
          needsOperator: 1,
          integrityIssues: 3,
        },
        integrity: {
          readiness: 'attention',
          issueCount: 3,
          taskIssueCount: 2,
          runIssueCount: 1,
          externalTaskCount: 1,
          externalRunCount: 1,
          taskModes: { orchestrated: 2, external: 1, recorded: 0, unknown: 0, inconsistent: 2 },
          runModes: { orchestrated: 3, external: 1, recorded: 0, unknown: 0, inconsistent: 1 },
          issues: [],
          issuesTruncated: false,
        },
      }),
      '/api/factory/execution-integrity': {
        ...integritySummary(3, 1),
        summary: {
          ...integritySummary(3, 1).summary,
          taskCount: 5,
          runCount: 6,
          taskModes: { orchestrated: 2, external: 1, recorded: 0, unknown: 0, inconsistent: 2 },
          runModes: { orchestrated: 3, external: 1, recorded: 0, unknown: 0, inconsistent: 1 },
        },
        tasks: [
          { taskId: 't1', taskName: 'one', taskStatus: 'done', specId: 's1', specName: 'spec', projectName: 'Ductum Core', runIds: [], executionMode: 'orchestrated', executionIssues: [], hasDuctumLineage: true, hasExternalOutcome: false, externalOutcome: null, bakeoffOutcome: null },
          { taskId: 't2', taskName: 'two', taskStatus: 'done', specId: 's1', specName: 'spec', projectName: 'Ductum Core', runIds: [], executionMode: 'orchestrated', executionIssues: [], hasDuctumLineage: true, hasExternalOutcome: false, externalOutcome: null, bakeoffOutcome: null },
          { taskId: 't3', taskName: 'three', taskStatus: 'active', specId: 's1', specName: 'spec', projectName: 'Ductum Core', runIds: [], executionMode: 'inconsistent', executionIssues: [], hasDuctumLineage: false, hasExternalOutcome: false, externalOutcome: null, bakeoffOutcome: null },
          { taskId: 't4', taskName: 'four', taskStatus: 'blocked', specId: 's1', specName: 'spec', projectName: 'Ductum Core', runIds: [], executionMode: 'external', executionIssues: [], hasDuctumLineage: false, hasExternalOutcome: true, externalOutcome: 'done', bakeoffOutcome: null },
          { taskId: 't5', taskName: 'five', taskStatus: 'pending', specId: 's1', specName: 'spec', projectName: 'Ductum Core', runIds: [], executionMode: 'inconsistent', executionIssues: [], hasDuctumLineage: false, hasExternalOutcome: false, externalOutcome: null, bakeoffOutcome: null },
        ],
        runs: [],
      },
      '/api/runs': [],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Factory needs you · 2/5 tasks done · 1 needs you · $0.00/wk')).toBeInTheDocument()
    })
    expect(screen.getByText('Task history')).toBeInTheDocument()
    expect(screen.getByText('2 done · 1 blocked/failed history · 1 active now · 1 ready')).toBeInTheDocument()
    expect(screen.getByText('Factory health')).toBeInTheDocument()
    expect(screen.getByText('Provenance')).toBeInTheDocument()
  })

  it('puts the needs-you inbox before Today and links to action detail without dumping recovery commands', async () => {
    const run = runFixture({
      id: 'run_quarantine',
      terminalState: 'quarantined',
      failReason: 'deterministic poison: fixture invariant failed',
      taskName: 'poison-task',
    })
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: run.createdAt, updatedAt: run.updatedAt },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: run.createdAt },
	      '/api/factory/operator-brief': operatorBrief({
	        queue: { approvalsWaiting: 0, activeRuns: 0, readyTasks: 0, needsOperator: 1, needsOperatorAttempts: [run], integrityIssues: 0 },
	      }),
      '/api/factory/home-view-state': { factoryId: 'f1', homeLastSeenAt: null, createdAt: null, updatedAt: null },
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [run],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Inbox')).toBeInTheDocument()
      expect(screen.getByText('Test · today')).toBeInTheDocument()
    })
    const inbox = screen.getByText('Inbox')
    const today = screen.getByText('Test · today')
    expect(inbox.compareDocumentPosition(today) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('1 item needs you')).toBeInTheDocument()
    expect(screen.getAllByText('Quarantined').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Open attempt poison-task' })).toHaveAttribute('href', '/Ductum%20Core/demo-spec/poison-task/run_qu')
    expect(screen.getByRole('link', { name: 'Open Factory Activity' })).toHaveAttribute('href', '/activity')
    expect(screen.queryByText('ductum status run_quarantine')).not.toBeInTheDocument()
    expect(screen.queryByText('Retry risk')).not.toBeInTheDocument()
  })

  it('shows repair ahead of approvals on Home when both exist', async () => {
    const blockedRun = runFixture({
      id: 'run_blocked',
      terminalState: 'quarantined',
      failReason: 'deterministic poison: fixture invariant failed',
      taskName: 'repair-first',
      updatedAt: '2026-06-19T02:00:00.000Z',
    })
    const approvalRun = runFixture({
      id: 'run_approval',
      stage: 'ship',
      pendingApproval: true,
      terminalState: null,
      taskName: 'approval-second',
      updatedAt: '2026-06-19T03:00:00.000Z',
    })
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: blockedRun.createdAt, updatedAt: blockedRun.updatedAt },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: blockedRun.createdAt },
	      '/api/factory/operator-brief': operatorBrief({
	        queue: { approvalsWaiting: 1, activeRuns: 1, readyTasks: 1, needsOperator: 1, needsOperatorAttempts: [blockedRun], integrityIssues: 0 },
	      }),
      '/api/factory/home-view-state': { factoryId: 'f1', homeLastSeenAt: null, createdAt: null, updatedAt: null },
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [approvalRun, blockedRun],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Factory needs you · no tasks yet · 1 needs you · $0.00/wk')).toBeInTheDocument()
    })
    const needsAttention = screen.getByText('Failed or stalled attempts')
    const approvalBanner = screen.getByText('Ship stage · awaiting human approval')
    expect(needsAttention.compareDocumentPosition(approvalBanner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open attempt repair-first' })).toHaveAttribute('href', '/Ductum%20Core/demo-spec/repair-first/run_bl')
    expect(screen.queryByText('ductum status run_blocked')).not.toBeInTheDocument()
  })

  it('renders empty state', async () => {
    fetchHelper = mockFetch({
      '/api/projects': [],
      '/api/factory': null,
      '/api/factory/operator-brief': operatorBrief(),
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [],
      '/api/agents': [],
    })
    renderWithProviders(<Home />)
    await waitFor(() => {
      expect(screen.getByText('No projects yet. Create one to begin.')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '+ New Project' })).toBeInTheDocument()
    expect(screen.queryByText(/ductum project create/)).not.toBeInTheDocument()
  })

  it('points protected Home 401s at the local dashboard start path', async () => {
    fetchHelper = mockFetch({
      '/api/projects': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/factory/operator-brief': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/factory/execution-integrity': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/runs': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/agents': { __status: 401, body: { error: 'Unauthorized' } },
    })
    renderWithProviders(<Home />)
    await waitFor(() => {
      expect(screen.getByText('Open local dashboard')).toBeInTheDocument()
    })
    expect(screen.getByText('Open the dashboard from ductum start so this browser receives its local session.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Session settings' })).not.toBeInTheDocument()
    expect(screen.queryByText('Factory data unavailable.')).not.toBeInTheDocument()
    expect(screen.queryByText('No projects yet. Create one to begin.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ New Project' })).not.toBeInTheDocument()
  })

  it('does not treat an empty Home failure list as an auth outage', () => {
    expect(getHomeUnavailableState([])).toEqual({ authUnavailable: false, unavailableReason: undefined })
  })

  it('does not hide a non-auth Home failure when another protected request is 401', async () => {
    fetchHelper = mockFetch({
      '/api/projects': { __status: 500, body: { error: 'Database offline' } },
      '/api/factory/operator-brief': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/factory/execution-integrity': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/runs': { __status: 401, body: { error: 'Unauthorized' } },
      '/api/agents': { __status: 401, body: { error: 'Unauthorized' } },
    })
    renderWithProviders(<Home />)
    await waitFor(() => {
      expect(screen.getByText(/Factory data unavailable/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Database offline/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Session settings' })).not.toBeInTheDocument()
    expect(screen.queryByText('No projects yet. Create one to begin.')).not.toBeInTheDocument()
  })

  it('renders loading state with shimmer', () => {
    fetchHelper = mockFetch({})
    const neverResolve = vi.fn(() => new Promise<Response>(() => {}))
    globalThis.fetch = neverResolve
    renderWithProviders(<Home />)
    expect(screen.getByText('Loading local factory session')).toBeInTheDocument()
    expect(screen.getByText(/run ductum start/)).toBeInTheDocument()
    const shimmers = document.querySelectorAll('.shimmer')
    expect(shimmers.length).toBeGreaterThan(0)
    fetchHelper.restore()
  })

  it('keeps superseded and old terminal runs out of homepage attention', async () => {
    const now = new Date().toISOString()
    const newer = new Date(Date.now() + 1000).toISOString()
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const baseRun = {
      id: 'run_failed',
      taskId: 'task1',
      agentId: 'agent1',
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
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 300,
      completionSummary: null,
      createdAt: now,
      updatedAt: now,
      taskName: 'demo-task',
      specName: 'demo-spec',
      projectName: 'Ductum Core',
      agentName: 'Codex',
      agentModel: 'gpt-5.4',
      retryCount: 0,
    }
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: now, updatedAt: now },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: now },
      '/api/factory/operator-brief': operatorBrief(),
      '/api/factory/execution-integrity': integritySummary(),
      '/api/runs': [
        { ...baseRun, id: 'run_failed', terminalState: 'failed', failReason: 'old retry failed' },
        { ...baseRun, id: 'run_done', stage: 'done', terminalState: null, failReason: null, updatedAt: newer },
        { ...baseRun, id: 'run_old_stalled', taskName: 'old-task', terminalState: 'stalled', failReason: 'stalled', createdAt: old, updatedAt: old },
      ],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Test · today')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failed or stalled attempts')).not.toBeInTheDocument()
  })

  it('shows execution mode badges for externally recorded runs', async () => {
    const now = new Date().toISOString()
    renderWithProviders(
      <RunSection
        title="Recent"
        runs={[{
          id: 'run_external',
          taskId: 'task1',
          agentId: 'agent1',
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
          taskName: 'external-task',
          specName: 'demo-spec',
          projectName: 'Ductum Core',
          agentName: 'Codex',
          agentModel: 'gpt-5.4',
          retryCount: 0,
          executionMode: 'external',
          executionIssues: [],
        } as never]}
      />,
    )

    expect(screen.getByText('External')).toBeInTheDocument()
    expect(screen.queryByText('external')).not.toBeInTheDocument()
  })

  it('buckets inconsistent completed runs as attention instead of completed', () => {
    const now = new Date().toISOString()
    const sections = buildRunSections([{
      id: 'run_inconsistent',
      taskId: 'task1',
      agentId: 'agent1',
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
      taskName: 'integrity-task',
      specName: 'demo-spec',
      projectName: 'Ductum Core',
      agentName: 'Codex',
      agentModel: 'gpt-5.4',
      retryCount: 0,
      executionMode: 'inconsistent',
      executionIssues: [{ code: 'final_evidence_on_non_done_run', message: 'run evidence contradicts state' }],
      hasDuctumLineage: false,
      hasExternalOutcome: false,
      externalOutcome: null,
      bakeoffOutcome: null,
    }])

    expect(sections.needsAttention).toHaveLength(1)
    expect(sections.recentDone).toHaveLength(0)
  })

  it('buckets quarantined and frozen runs as needs-attention', () => {
    const now = new Date().toISOString()
    const base = {
      id: 'run', taskId: 'task1', agentId: 'agent1', parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null, branch: null,
      commitSha: null, prNumber: null, prUrl: null, worktreePaths: [],
      ciStatus: null, reviewStatus: null, failReason: null, recoverable: true,
      tokensIn: 0, tokensOut: 0, costUsd: 0, lastHeartbeat: null,
      heartbeatTimeoutSeconds: 300, completionSummary: null, createdAt: now, updatedAt: now,
      taskName: 't', specName: 's', projectName: 'p', agentName: 'a', agentModel: 'm',
      retryCount: 0, executionMode: 'orchestrated' as const, executionIssues: [],
      hasDuctumLineage: false, hasExternalOutcome: false, externalOutcome: null, bakeoffOutcome: null,
    }
    const sections = buildRunSections([
      { ...base, id: 'run-q', terminalState: 'quarantined', failReason: 'deterministic poison' },
      { ...base, id: 'run-f', terminalState: 'frozen', failReason: 'cost_budget_paused' },
    ])

    const ids = sections.needsAttention.map((run) => run.id)
    expect(ids).toContain('run-q')
    expect(ids).toContain('run-f')
  })

  it('surfaces inconsistent rows in the homepage progress surface and live stream', async () => {
    const now = new Date().toISOString()
    const issues = Array.from({ length: 6 }, (_, index) => ({
      scope: 'task',
      id: `task${index + 1}`,
      projectName: 'Ductum Core',
      specName: 'demo-spec',
      taskName: index === 0 ? 'integrity-task' : `integrity-task-${index + 1}`,
      runId: null,
      executionMode: 'inconsistent',
      issueCode: 'done_task_without_lineage_or_external_outcome',
      issueMessage: 'done task has no lineage',
      status: 'done',
    }))
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: now, updatedAt: now },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: now },
      '/api/factory/operator-brief': operatorBrief({
        queue: {
          approvalsWaiting: 0,
          activeRuns: 0,
          readyTasks: 0,
          needsOperator: 0,
          integrityIssues: 6,
        },
        integrity: {
          readiness: 'attention',
          issueCount: 6,
          taskIssueCount: 6,
          runIssueCount: 0,
          externalTaskCount: 0,
          externalRunCount: 0,
          taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 6 },
          runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
          issues,
          issuesTruncated: true,
        },
      }),
      '/api/factory/execution-integrity': integritySummary(6),
      '/api/runs': [{
        id: 'run_inconsistent',
        taskId: 'task1',
        agentId: 'agent1',
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
        taskName: 'integrity-task',
        specName: 'demo-spec',
        projectName: 'Ductum Core',
        agentName: 'Codex',
        agentModel: 'gpt-5.4',
        retryCount: 0,
        executionMode: 'inconsistent',
        executionIssues: [{ code: 'final_evidence_on_non_done_run', message: 'run evidence contradicts state' }],
        hasDuctumLineage: false,
        hasExternalOutcome: false,
        externalOutcome: null,
        bakeoffOutcome: null,
      }],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getAllByText('integrity-task').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Factory health')).toBeInTheDocument()
    expect(screen.getAllByText('Integrity watch').length).toBeGreaterThan(0)
    expect(screen.getByText('Showing first 5 contradictions from the API summary.')).toBeInTheDocument()
    // Integrity rows show a human label, not the raw issue code (P7C).
    expect(screen.getAllByText('Completed task has no traceable attempt').length).toBeGreaterThan(0)
    expect(screen.queryByText('done_task_without_lineage_or_external_outcome')).not.toBeInTheDocument()
    expect(screen.getAllByText('Inconsistent').length).toBeGreaterThan(0)
    expect(screen.queryByText('inconsistent:1')).not.toBeInTheDocument()
  })

  it('shows external integrity records without counting them as warnings', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p1', name: 'Ductum Core', repos: ['edictum-ai/ductum'], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: now, updatedAt: now },
      ],
      '/api/factory': { id: 'f1', name: 'Test', config: {}, createdAt: now },
      '/api/factory/operator-brief': operatorBrief({
        integrity: {
          readiness: 'clear',
          issueCount: 0,
          taskIssueCount: 0,
          runIssueCount: 0,
          externalTaskCount: 2,
          externalRunCount: 2,
          taskModes: { orchestrated: 0, external: 2, recorded: 0, unknown: 0, inconsistent: 0 },
          runModes: { orchestrated: 0, external: 2, recorded: 0, unknown: 0, inconsistent: 0 },
          issues: [],
          issuesTruncated: false,
        },
      }),
      '/api/factory/execution-integrity': integritySummary(0, 2),
      '/api/runs': [],
      '/api/agents': [],
    })

    renderWithProviders(<Home />)

    await waitFor(() => {
      expect(screen.getByText('Test · today')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(fetchHelper.mock.mock.calls.some(([url]) => String(url).includes('/api/factory/execution-integrity'))).toBe(true)
    })
    await waitFor(() => {
      expect(screen.getAllByText('External').length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('shows task integrity warnings in project spec rows', () => {
    const now = new Date().toISOString()
    renderWithProviders(
      <SpecSection
        spec={{ id: 'spec1', projectId: 'p1', name: 'integrity-spec', status: 'approved', document: '', createdAt: now, updatedAt: now }}
        tasks={[{
          id: 'task1',
          specId: 'spec1',
          name: 'external-task',
          prompt: '',
          repos: [],
          assignedAgentId: null,
          requiredRole: null,
          complexity: null,
          status: 'done',
          verification: [],
          createdAt: now,
          updatedAt: now,
          executionMode: 'inconsistent',
          executionIssues: [{ code: 'done_task_without_lineage_or_external_outcome', message: 'done task has no lineage' }],
        }]}
        specRuns={[]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="ductum"
      />,
    )

    expect(screen.getByText('Inconsistent: 1 issue')).toBeInTheDocument()
    expect(screen.queryByText('inconsistent:1')).not.toBeInTheDocument()
  })

  it('shows task integrity warnings on the spec detail task list', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/resolve/ductum/integrity-spec': {
        project: { id: 'p1', name: 'ductum', repos: [], config: { mergeMode: 'auto' }, factoryId: 'f1', createdAt: now, updatedAt: now },
        spec: { id: 'spec1', projectId: 'p1', name: 'integrity-spec', status: 'approved', document: '', createdAt: now, updatedAt: now },
      },
      '/api/specs/spec1/tasks': [{
        id: 'task1',
        specId: 'spec1',
        name: 'external-task',
        prompt: '',
        repos: [],
        assignedAgentId: null,
        requiredRole: null,
        complexity: null,
        status: 'done',
        verification: [],
        createdAt: now,
        updatedAt: now,
        executionMode: 'inconsistent',
        executionIssues: [{ code: 'done_task_without_lineage_or_external_outcome', message: 'done task has no lineage' }],
      }],
      '/api/decisions': [],
      '/api/runs': [],
    })

    renderWithProviders(
      <Routes>
        <Route path="/:project/:spec" element={<SpecDetail />} />
      </Routes>,
      { route: '/ductum/integrity-spec' },
    )

    await waitFor(() => {
      expect(screen.getByText('external-task')).toBeInTheDocument()
    })
    expect(screen.getByText('Inconsistent: 1 issue')).toBeInTheDocument()
    expect(screen.queryByText('inconsistent:1')).not.toBeInTheDocument()
  })
})

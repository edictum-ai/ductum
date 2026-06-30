import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { SpecDetail } from '@/pages/SpecDetail'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

const now = '2026-06-15T12:00:00.000Z'
const older = '2026-06-15T10:00:00.000Z'

function project() {
  return {
    id: 'project1',
    name: 'Ductum Core',
    repos: [],
    config: { mergeMode: 'auto', workflowPath: 'coding-guard' },
    factoryId: 'factory1',
    createdAt: older,
    updatedAt: now,
  }
}

function spec(status = 'done', overrides: Record<string, unknown> = {}) {
  return {
    id: 'spec1',
    projectId: 'project1',
    name: 'truthful-spec',
    status,
    document: 'Make spec detail honest.',
    createdAt: older,
    updatedAt: now,
    ...overrides,
  }
}

function task(name: string, status = 'done') {
  return {
    id: `task-${name}`,
    specId: 'spec1',
    name,
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status,
    verification: [],
    createdAt: older,
    updatedAt: now,
  }
}

function run(overrides: Record<string, unknown>) {
  return {
    id: 'run_base',
    taskId: 'task-build',
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
    createdAt: older,
    updatedAt: older,
    taskName: 'build',
    specName: 'truthful-spec',
    projectName: 'Ductum Core',
    agentName: 'Codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    ...overrides,
  }
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision1',
    specId: 'spec1',
    taskId: null,
    runId: null,
    decision: 'Keep review decisions above the source doc',
    context: 'Operators need the current judgment before reading the full spec text.',
    alternatives: null,
    decidedBy: 'Arnold',
    supersedesId: null,
    createdAt: now,
    ...overrides,
  }
}

function renderSpecDetail(route = '/Ductum%20Core/truthful-spec') {
  return renderWithProviders(
    <Routes>
      <Route path="/:project/:spec" element={<SpecDetail />} />
    </Routes>,
    { route },
  )
}

describe('SpecDetail truthfulness', () => {
  afterEach(() => fetchHelper?.restore())

  it('shows terminal failures on a done spec as historical and keeps spend partial', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': { project: project(), spec: spec('done') },
      '/api/specs/spec1/tasks': [task('build'), task('review')],
      '/api/agents': [],
      '/api/decisions': [],
      '/api/runs': [
        run({
          id: 'run_failed_old',
          taskName: 'build',
          terminalState: 'failed',
          failReason: 'verification failed before retry',
        }),
        run({
          id: 'run_done_new',
          taskName: 'build',
          taskId: 'task-build',
          stage: 'done',
          terminalState: null,
          costUsd: 2.5,
          tokensIn: 1000,
          tokensOut: 2000,
          updatedAt: now,
        }),
        run({
          id: 'run_stalled_old',
          taskName: 'review',
          taskId: 'task-review',
          terminalState: 'stalled',
          failReason: 'heartbeat stopped before handoff',
        }),
      ],
    })

    renderSpecDetail()

    await waitFor(() => {
      expect(screen.getByText('truthful-spec')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('0 current · 2 historical').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Failing')).not.toBeInTheDocument()
    expect(screen.getByText('Terminal attempts')).toBeInTheDocument()
    expect(screen.queryByText('Evidence ledger')).not.toBeInTheDocument()
    expect(screen.getByText('Failed/stalled attempts')).toBeInTheDocument()
    expect(screen.getAllByText('historical/superseded')).toHaveLength(2)
    expect(screen.getByText('verification failed before retry')).toBeInTheDocument()
    expect(screen.getByText('heartbeat stopped before handoff')).toBeInTheDocument()
    expect(screen.getAllByText('Measured spend')).toHaveLength(1)
    expect(screen.getByText('2 unmeasured')).toBeInTheDocument()
    expect(screen.getByText('3.0k measured tokens · 2 unmeasured attempts')).toBeInTheDocument()
  })

  it('puts decisions before a collapsed spec document', async () => {
    const longDocument = `Use the short summary first.\n\n${'Detailed source paragraph. '.repeat(120)}UNIQUE_FULL_SPEC_BODY`
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': { project: project(), spec: { ...spec('approved'), document: longDocument } },
      '/api/specs/spec1/tasks': [task('build', 'ready')],
      '/api/agents': [],
      '/api/decisions': [decision()],
      '/api/runs': [],
    })

    renderSpecDetail()

    await waitFor(() => {
      expect(screen.getByText('truthful-spec')).toBeInTheDocument()
    })

    const decisionText = await screen.findByText('Keep review decisions above the source doc')
    const decisionsHeader = screen.getByText('Decisions')
    const documentHeader = screen.getByText('Spec document')
    expect(decisionsHeader.compareDocumentPosition(documentHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(decisionText).toBeInTheDocument()
    expect(screen.queryByText(/UNIQUE_FULL_SPEC_BODY/)).not.toBeInTheDocument()
    expect(screen.getByText(/\d\.\dk chars/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show' }))

    expect(screen.getByText(/UNIQUE_FULL_SPEC_BODY/)).toBeInTheDocument()
  })

  it('skips redacted raw document lines when building the visible spec brief', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': {
        project: project(),
        spec: spec('approved', {
          document: '# Internal title\n\ngithubToken: [redacted]\n\nIn one sentence: Show project and spec purpose before attempt history.',
        }),
      },
      '/api/specs/spec1/tasks': [task('build', 'ready')],
      '/api/agents': [],
      '/api/decisions': [],
      '/api/runs': [],
    })

    renderSpecDetail()

    await waitFor(() => {
      expect(screen.getByText('truthful-spec')).toBeInTheDocument()
    })

    expect(screen.getByText('Show project and spec purpose before attempt history.')).toBeInTheDocument()
    expect(screen.queryByText('githubToken: [redacted]')).not.toBeInTheDocument()
  })

  it('marks terminal failures on unfinished work as current', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': { project: project(), spec: spec('approved') },
      '/api/specs/spec1/tasks': [task('build', 'active')],
      '/api/agents': [],
      '/api/decisions': [],
      '/api/runs': [
        run({
          id: 'run_failed_current',
          taskName: 'build',
          terminalState: 'failed',
          failReason: 'tests are still failing',
        }),
      ],
    })

    renderSpecDetail()

    await waitFor(() => {
      expect(screen.getByText('truthful-spec')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.getAllByText('1 current · 0 historical').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('current')).toBeInTheDocument()
    expect(screen.getByText('tests are still failing')).toBeInTheDocument()
    expect(screen.getByText(/unfinished work/)).toBeInTheDocument()
  })
})

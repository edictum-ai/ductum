import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { SpecList } from '@/pages/SpecList'
import type { EnrichedRun } from '@/api/client'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

afterEach(() => {
  fetchHelper?.restore()
})

describe('SpecList', () => {
  it('groups specs by project, hides failed specs from the default view, and filters attention work', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [
        project('p1', 'Ductum Core', now),
        project('p2', 'Faceless', now),
      ],
      '/api/projects/p1/specs': [
        spec('s1', 'p1', 'failed-spec', 'implementing', now),
        spec('s2', 'p1', 'live-spec', 'implementing', now),
      ],
      '/api/projects/p1/tasks': [
        task('t1', 's1', 'task-a'),
        task('t2', 's2', 'task-b'),
        task('t3', 's2', 'task-c'),
      ],
      '/api/projects/p2/specs': [
        spec('s3', 'p2', 'quiet-spec', 'done', now),
      ],
      '/api/projects/p2/tasks': [
        task('t4', 's3', 'task-d'),
      ],
      '/api/runs': [
        run({ id: 'r1', projectName: 'Ductum Core', specName: 'failed-spec', terminalState: 'failed', pendingApproval: true }),
        run({ id: 'r2p', projectName: 'Ductum Core', specName: 'live-spec', stage: 'ship', pendingApproval: true, terminalState: null }),
        run({ id: 'r2', parentRunId: 'r2p', projectName: 'Ductum Core', specName: 'live-spec', terminalState: null }),
        run({ id: 'r3', projectName: 'Faceless', specName: 'quiet-spec', stage: 'done', terminalState: null }),
      ],
    })

    renderWithProviders(<SpecList />)

    await waitFor(() => {
      expect(screen.getByText('Ductum Core')).toBeInTheDocument()
      expect(screen.getByText('Faceless')).toBeInTheDocument()
    })
    // Stored spec.status drives the header: live-spec is 'implementing',
    // quiet-spec is 'done'. The visual badge is derived per row.
    expect(screen.getByText('1 spec · 1 implementing')).toBeInTheDocument()
    expect(screen.getByText('1 spec · 1 done')).toBeInTheDocument()
    expect(screen.getByText('in flight')).toBeInTheDocument()
    expect(screen.queryByText('approval')).not.toBeInTheDocument()
    expect(screen.queryByText('failed-spec')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Needs attention (1)' }))

    expect(await screen.findByText('failed-spec')).toBeInTheDocument()
    expect(screen.getByText('1 spec · 1 implementing')).toBeInTheDocument()
    expect(screen.getAllByText('failed').length).toBeGreaterThan(0)
  })

  it('renders a done spec as done even when older runs failed', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [
        project('p1', 'Ductum Core', now),
      ],
      '/api/projects/p1/specs': [
        spec('s1', 'p1', 'shipped-spec', 'done', now),
      ],
      '/api/projects/p1/tasks': [
        task('t1', 's1', 'task-a'),
        task('t2', 's1', 'task-b'),
      ],
      '/api/runs': [
        run({
          id: 'old-failed-run',
          projectName: 'Ductum Core',
          specName: 'shipped-spec',
          stage: 'implement',
          terminalState: 'failed',
        }),
      ],
    })

    renderWithProviders(<SpecList />)

    expect(await screen.findByText('shipped-spec')).toBeInTheDocument()
    expect(screen.getByText('1 spec · 1 done')).toBeInTheDocument()
    // The "done" badge in the row should beat the historical failed run.
    expect(screen.getAllByText('done').length).toBeGreaterThan(0)
    expect(screen.queryByText('failed')).not.toBeInTheDocument()
  })

  it('does not count terminal failed runs as active even when the stored spec status is implementing', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/projects': [
        project('p1', 'Ductum Core', now),
      ],
      '/api/projects/p1/specs': [
        spec('s1', 'p1', 'failed-implementing-spec', 'implementing', now),
      ],
      '/api/projects/p1/tasks': [
        task('t1', 's1', 'task-a'),
      ],
      '/api/runs': [
        run({
          id: 'failed-run',
          projectName: 'Ductum Core',
          specName: 'failed-implementing-spec',
          stage: 'implement',
          terminalState: 'failed',
        }),
      ],
    })

    renderWithProviders(<SpecList />)

    expect(await screen.findByText('current specs')).toBeInTheDocument()
    expect(screen.getAllByText('0')).toHaveLength(2)
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.queryByText('failed-implementing-spec')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Needs attention (1)' }))

    expect(await screen.findByText('failed-implementing-spec')).toBeInTheDocument()
    expect(screen.getByText('1 spec · 1 implementing')).toBeInTheDocument()
  })
})

function task(id: string, specId: string, name: string) {
  const now = new Date().toISOString()
  return {
    id,
    specId,
    name,
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'pending',
    verification: [],
    createdAt: now,
    updatedAt: now,
  }
}

function project(id: string, name: string, now: string) {
  return { id, name, repos: [], config: { mergeMode: 'human' }, factoryId: 'f1', createdAt: now, updatedAt: now }
}

function spec(id: string, projectId: string, name: string, status: string, now: string) {
  return { id, projectId, name, status, document: '', createdAt: now, updatedAt: now }
}

function run(overrides: Partial<EnrichedRun>): EnrichedRun {
  const now = new Date().toISOString()
  return {
    id: 'r0',
    taskId: 't1',
    agentId: 'a1',
    parentRunId: null,
    sessionId: null,
    stage: 'implement',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    worktreePaths: null,
    createdAt: now,
    updatedAt: now,
    taskName: 'task',
    specName: 'spec',
    projectName: 'project',
    agentName: 'agent',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  } as EnrichedRun
}

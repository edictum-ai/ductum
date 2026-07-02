import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { RunDetail } from '@/pages/RunDetail'
import { mockFetch, renderWithProviders } from './test-utils'

const BASE_PROJECT = { id: 'p1', factoryId: 'f1', name: 'ductum', repos: [], config: { mergeMode: 'squash', workflowPath: '' }, createdAt: '', updatedAt: '' }
const BASE_SPEC = { id: 's1', projectId: 'p1', name: 'impl-005', status: 'implementing', document: '', createdAt: '', updatedAt: '' }
const BASE_TASK = { id: 't1', specId: 's1', name: 'P2-DIFF-CI-PR', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: '', updatedAt: '' }

const BASE_RUN = {
  id: 'run_abc123', taskId: 't1', agentId: 'a1', parentRunId: null,
  sessionId: 'sess_1', branch: 'feat/test', commitSha: 'abc1234',
  prNumber: 42, prUrl: 'https://github.com/test/test/pull/42',
  ciStatus: 'pass', reviewStatus: 'pass', failReason: null, recoverable: true,
  terminalState: null, resetCount: 0, completedStages: [], blockedReason: null, pendingApproval: false,
  tokensIn: 100000, tokensOut: 15000, costUsd: 1.25,
  lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date().toISOString(),
}

const SAMPLE_DIFF = {
  diff: 'diff --git a/src/foo.ts b/src/foo.ts\nindex 1111..2222 100644\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old line\n+new line\n',
  files: [{ path: 'src/foo.ts', insertions: 1, deletions: 1, status: 'text' as const }],
  totals: { files: 1, insertions: 1, deletions: 1 },
  base: 'main',
  truncated: false,
}

const EMPTY_DIFF = {
  diff: '',
  files: [],
  totals: { files: 0, insertions: 0, deletions: 0 },
  base: 'main',
  truncated: false,
}
const RUNNING_UI = { schemaVersion: 'ductum.ui.run.v1', status: { key: 'running', label: 'Running', tone: 'info', terminal: false, needsAttention: false }, cost: { usd: 0, label: 'pending', state: 'pending' }, href: null }

function attemptForRun(run: Record<string, unknown>) {
  return {
    ...run,
    recordType: 'Attempt',
    name: run.id,
    status: run.terminalState === 'failed' ? 'failed' : run.terminalState === 'stalled' ? 'blocked' : run.stage === 'done' ? 'done' : 'running',
    parentAttemptId: run.parentRunId,
    snapshot: { completeness: 'full', legacy: false, runtime: {}, missingFields: [] },
  }
}

function renderRunDetail(stage: string, overrides: Record<string, unknown> = {}, diffResponse: unknown = null) {
  const run = { ...BASE_RUN, stage, ...overrides }
  const responses: Record<string, unknown> = {
    '/api/resolve/ductum/impl-005/P2-DIFF-CI-PR/run_ab': { project: BASE_PROJECT, spec: BASE_SPEC, task: BASE_TASK, run },
    '/api/attempts/run_abc123': attemptForRun(run),
    '/api/specs/s1/tasks': [BASE_TASK],
    '/api/tasks/t1/runs': [run],
    '/api/runs/run_abc123/evidence': [],
    '/api/runs/run_abc123/history': [],
    '/api/runs/run_abc123/gate-evaluations': [],
    '/api/runs/run_abc123/updates': [],
    '/api/runs/run_abc123/activity': [],
    '/api/decisions': [],
    '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
    '/api/factory': null,
  }
  if (diffResponse !== null) {
    responses['/api/runs/run_abc123/diff'] = diffResponse
  }
  const { mock, restore } = mockFetch(responses)
  const result = renderWithProviders(
    <Routes>
      <Route path="/:project/:spec/:task" element={<div>Task route</div>} />
      <Route path="/:project/:spec/:task/:runId" element={<RunDetail />} />
    </Routes>,
    { route: '/ductum/impl-005/P2-DIFF-CI-PR/run_ab' },
  )
  return { ...result, mock, restore }
}

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

function diffCallCount(mock: ReturnType<typeof mockFetch>['mock']): number {
  return mock.mock.calls.filter(([url]) => String(url).includes('/api/runs/run_abc123/diff')).length
}

describe('RunDetail non-approval diff availability (issue #211)', () => {
  it('loads and renders the worktree diff for a failed attempt with a preserved worktree', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { terminalState: 'failed', failReason: 'exit code 1', worktreePaths: ['/tmp/worktree'] },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('src/foo.ts').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
  })

  it('loads and renders the worktree diff for a stalled attempt with a preserved worktree', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { terminalState: 'stalled', blockedReason: 'startup reconcile found no live lease', worktreePaths: ['/tmp/worktree'] },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('src/foo.ts').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
  })

  it('loads and renders the worktree diff for a running attempt with a preserved worktree', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'] },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('src/foo.ts').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
  })

  it('refreshes the worktree diff while a preserved-worktree attempt is running', async () => {
    const { restore, mock } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'] },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(diffCallCount(mock)).toBe(1)
    })
    await waitFor(() => {
      expect(diffCallCount(mock)).toBeGreaterThan(1)
    }, { timeout: 4000, interval: 100 })
  }, 7000)

  it('renders an explicit unavailable state when a failed attempt has no preserved worktree', async () => {
    const { restore, mock } = renderRunDetail(
      'implement',
      { terminalState: 'failed', failReason: 'exit code 1', worktreePaths: null },
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    expect(screen.getByText('Diff unavailable')).toBeInTheDocument()
    expect(screen.getByText(/No worktree was preserved for this attempt/)).toBeInTheDocument()
    // The diff endpoint is NOT hit when there is no worktree — the dashboard
    // refuses to fabricate a fetch it knows will 404.
    expect(diffCallCount(mock)).toBe(0)
  })

  it('renders an explicit unavailable state for a running attempt before the worktree is created', async () => {
    const { restore } = renderRunDetail('implement', { worktreePaths: null })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    expect(screen.getByText('Diff unavailable')).toBeInTheDocument()
    expect(screen.getByText(/No worktree has been preserved for this attempt yet/)).toBeInTheDocument()
  })

  it('shows the empty-changes state (not the unavailable state) when the worktree diff has zero files', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { terminalState: 'failed', worktreePaths: ['/tmp/worktree'] },
      EMPTY_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText(/No changes detected against main/)).toBeInTheDocument()
    })
    expect(screen.queryByText('Diff unavailable')).not.toBeInTheDocument()
  })

  it('does not render the worktree diff card for done attempts even with a preserved worktree', async () => {
    const { restore } = renderRunDetail(
      'done',
      { worktreePaths: ['/tmp/worktree'], completionSummary: 'shipped' },
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText(/Completion Summary/).length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Worktree changes vs main')).not.toBeInTheDocument()
    expect(screen.queryByText('Changes vs main')).not.toBeInTheDocument()
  })

  it('does not fetch a hidden diff for blocked attempts even with a preserved worktree', async () => {
    const { restore, mock } = renderRunDetail(
      'implement',
      {
        worktreePaths: ['/tmp/worktree'],
        blockedReason: 'waiting on operator input',
        ui: RUNNING_UI,
      },
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('waiting on operator input').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Worktree changes vs main')).not.toBeInTheDocument()
    expect(diffCallCount(mock)).toBe(0)
  })

  it('does not fetch a hidden diff for cancelled attempts even with a preserved worktree', async () => {
    const { restore, mock } = renderRunDetail(
      'implement',
      { terminalState: 'cancelled', worktreePaths: ['/tmp/worktree'] },
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Worktree changes vs main')).not.toBeInTheDocument()
    expect(diffCallCount(mock)).toBe(0)
  })
})

describe('RunDetail CI / PR link rendering (issue #211)', () => {
  it('renders the PR URL as a link when run.prUrl is present', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'], prUrl: 'https://github.com/test/test/pull/42', prNumber: 42 },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    const prLink = screen.getByRole('link', { name: /PR #42/ })
    expect(prLink).toHaveAttribute('href', 'https://github.com/test/test/pull/42')
    expect(prLink).toHaveAttribute('target', '_blank')
  })

  it('renders the CI latch as status text when both run.ciStatus and run.prUrl are present', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'], ciStatus: 'pass', prUrl: 'https://github.com/test/test/pull/42' },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    const ciLabel = screen.getByText('CI:')
    const ciBlock = ciLabel.parentElement
    expect(ciBlock?.textContent ?? '').toMatch(/\bpass\b/)
    expect(screen.queryByRole('link', { name: /pass/ })).toBeNull()
  })

  it('renders the CI latch as plain text when run.prUrl is absent (no fabricated link)', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'], ciStatus: 'fail', prUrl: null, prNumber: null },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    // The CI value renders, but it is NOT a link — the dashboard must not
    // synthesize a check URL from a branch or commit alone.
    const ciLabel = screen.getByText('CI:')
    const ciBlock = ciLabel.parentElement
    expect(ciBlock?.textContent ?? '').toMatch(/\bfail\b/)
    const ciLink = screen.queryByRole('link', { name: /fail/ })
    expect(ciLink).toBeNull()
  })

  it('omits the external-context card entirely when neither run.prUrl nor run.ciStatus is set', async () => {
    const { restore } = renderRunDetail(
      'implement',
      { worktreePaths: ['/tmp/worktree'], prUrl: null, prNumber: null, ciStatus: null },
      SAMPLE_DIFF,
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Worktree changes vs main')).toBeInTheDocument()
    })
    expect(screen.queryByText('External context')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /PR #/ })).not.toBeInTheDocument()
  })
})

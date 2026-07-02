import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { RunDetail } from '@/pages/RunDetail'
import { mockFetch, renderWithProviders } from './test-utils'

const BASE_PROJECT = { id: 'p1', factoryId: 'f1', name: 'ductum', repos: [], config: { mergeMode: 'squash', workflowPath: '' }, createdAt: '', updatedAt: '' }
const BASE_SPEC = { id: 's1', projectId: 'p1', name: 'impl-005', status: 'implementing', document: '', createdAt: '', updatedAt: '' }
const BASE_TASK = { id: 't1', specId: 's1', name: 'P1-TRIAGE', prompt: '', repos: [], assignedAgentId: null, requiredRole: null, complexity: null, status: 'active', verification: [], createdAt: '', updatedAt: '' }
const NEXT_TASK = { ...BASE_TASK, id: 't2', name: 'P2-BUILD', status: 'ready' }

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

function attemptForRun(run: Record<string, unknown>, snapshotOverrides: Record<string, unknown> = {}) {
  return {
    ...run,
    recordType: 'Attempt',
    name: run.id,
    status: run.terminalState === 'failed' ? 'failed' : run.terminalState === 'stalled' ? 'blocked' : run.stage === 'done' ? 'done' : 'running',
    parentAttemptId: run.parentRunId,
    snapshot: {
      completeness: 'full',
      legacy: false,
      runtime: {},
      missingFields: [],
      ...snapshotOverrides,
    },
  }
}

function renderRunDetail(
  stage: string,
  overrides: Record<string, unknown> = {},
  activity: unknown[] = [],
  snapshotOverrides: Record<string, unknown> = {},
) {
  const run = { ...BASE_RUN, stage, ...overrides }
  const { mock, restore } = mockFetch({
    '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project: BASE_PROJECT, spec: BASE_SPEC, task: BASE_TASK, run },
    '/api/attempts/run_abc123': attemptForRun(run, snapshotOverrides),
    '/api/specs/s1/tasks': [BASE_TASK, NEXT_TASK],
    '/api/tasks/t1/runs': [run],
    '/api/runs/run_abc123/evidence': [],
    '/api/runs/run_abc123/history': [],
    '/api/runs/run_abc123/gate-evaluations': [],
    '/api/runs/run_abc123/updates': [],
    '/api/runs/run_abc123/activity': activity,
    '/api/runs/run_abc123/secret-access-history': [],
    '/api/decisions': [],
    '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
    '/api/factory': null,
  })
  const result = renderWithProviders(
    <Routes>
      <Route path="/:project/:spec/:task" element={<div>Task route</div>} />
      <Route path="/:project/:spec/:task/:runId" element={<RunDetail />} />
    </Routes>,
    { route: '/ductum/impl-005/P1-TRIAGE/run_ab' },
  )
  return { ...result, mock, restore }
}

let cleanup: (() => void) | null = null
afterEach(() => cleanup?.())

describe('RunDetail', () => {
  it('renders agent name and token info', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getAllByText('Mimi').length).toBeGreaterThan(0)
      expect(screen.getByText('100.0k / 15.0k')).toBeInTheDocument()
    })
  }, 10_000)

  it('shows stage badge for failed runs', async () => {
    const { restore } = renderRunDetail('implement', { terminalState: 'failed' })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  it('shows approval panel only when pendingApproval is true', async () => {
    const { restore } = renderRunDetail('ship', { pendingApproval: true })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Intervention controls')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Approve & merge' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    })
  })

  it('does not show approval actions when pendingApproval is false', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Approve & merge' })).not.toBeInTheDocument()
  })

  it('shows approval panel in ship stage', async () => {
    const { restore } = renderRunDetail('ship', { pendingApproval: true })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/Review the changes above before approval/)).toBeInTheDocument()
  })

  it('uses Attempt copy on the detail surface', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Attempt detail')).toBeInTheDocument()
    })
    expect(screen.queryByText('Run detail')).not.toBeInTheDocument()
  })

  it('shows a legacy / partial-history banner when the attempt snapshot is incomplete', async () => {
    const { restore } = renderRunDetail(
      'implement',
      {},
      [],
      { completeness: 'partial-legacy', legacy: true, missingFields: ['spec', 'agent', 'provider', 'model.providerModelId', 'repository'] },
    )
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Legacy / partial history')).toBeInTheDocument()
      expect(screen.getByText(/without a full runtime snapshot/i)).toBeInTheDocument()
      expect(screen.getByText(/Missing snapshot fields: spec, agent, provider, model\.providerModelId \+1 more/)).toBeInTheDocument()
    })
  })

  it('does not show the legacy banner for full attempt snapshots', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
    expect(screen.queryByText('Legacy / partial history')).not.toBeInTheDocument()
  })

  it('shows enforcement stage strip', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Workflow stage')).toBeInTheDocument()
    })
  })

  it('shows failure summary card for failed runs', async () => {
    const { restore } = renderRunDetail('implement', { terminalState: 'failed', failReason: 'retried by operator' })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Failure Summary')).toBeInTheDocument()
      expect(screen.getAllByText('retried by operator').length).toBeGreaterThan(0)
    })
  })

  it('shows failure summary card for stalled runs', async () => {
    const { restore } = renderRunDetail('implement', { terminalState: 'stalled' })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Failure Summary')).toBeInTheDocument()
      // Shows heartbeat timeout cause when no failReason
      expect(screen.getByText(/Heartbeat timeout/)).toBeInTheDocument()
    })
  })

  it('does not show failure summary for active runs', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
    expect(screen.queryByText('Failure Summary')).not.toBeInTheDocument()
  })

  it('shows blocked reason for live runs that are not approval-ready yet', async () => {
    const { restore } = renderRunDetail('ship', {
      pendingApproval: false,
      blockedReason: 'External PR review required before ship: waiting for external CI and external GitHub review.',
    })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0)
      expect(
        screen.getAllByText(/waiting for external CI and external GitHub review/).length,
      ).toBeGreaterThan(0)
    })
  })

  it('shows completion summary card for done runs with completionSummary field', async () => {
    const { restore } = renderRunDetail('done', { completionSummary: 'Added run failure summary components.' })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Completion Summary').length).toBeGreaterThan(0)
      expect(screen.getByText('Merged to main abc1234')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open next task' })).toHaveAttribute('href', '/ductum/impl-005/P2-BUILD')
      expect(screen.getAllByText('Added run failure summary components.').length).toBeGreaterThan(0)
    })
  })

  it('shows completion summary from last result activity when no completionSummary field', async () => {
    const activity = [
      { id: 1, runId: 'run_abc123', kind: 'text', content: 'Thinking...', toolName: null, createdAt: new Date().toISOString() },
      { id: 2, runId: 'run_abc123', kind: 'result', content: 'Session completed successfully.', toolName: null, createdAt: new Date().toISOString() },
    ]
    const { restore } = renderRunDetail('done', {}, activity)
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Completion Summary').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Session completed successfully.').length).toBeGreaterThan(0)
    })
  })

  it('renders Ductum review results as verdict cards instead of raw JSON', async () => {
    const reviewResult = JSON.stringify({ kind: 'ductum-review-result', verdict: 'fail', summary: 'Review found blocking issues.', findings: [{ severity: 'P1', file: 'src/run.ts', line: 42, title: 'Missing verification gate' }] })
    const { restore } = renderRunDetail('done', { completionSummary: reviewResult })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Review verdict')).toBeInTheDocument()
      expect(screen.getByText('FAIL')).toBeInTheDocument()
      expect(screen.getByText('Review found blocking issues.')).toBeInTheDocument()
      expect(screen.getByText(/src\/run.ts/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/ductum-review-result/)).not.toBeInTheDocument()
  })

  it('shows completion summary from last text activity as final fallback', async () => {
    const activity = [
      { id: 1, runId: 'run_abc123', kind: 'text', content: 'Implementation complete. All features are working.', toolName: null, createdAt: new Date().toISOString() },
    ]
    const { restore } = renderRunDetail('done', {}, activity)
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Completion Summary').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Implementation complete/).length).toBeGreaterThan(0)
    })
  })

  it('shows last action in meta bar for active runs', async () => {
    const activity = [
      { id: 1, runId: 'run_abc123', kind: 'tool_call', content: JSON.stringify({ file_path: '/project/ductum/packages/core/src/enforce.ts' }), toolName: 'Write', createdAt: new Date(Date.now() - 180000).toISOString() },
    ]
    const { restore } = renderRunDetail('implement', {}, activity)
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText(/enforce\.ts/).length).toBeGreaterThan(0)
      expect(screen.getAllByText('Activity').length).toBeGreaterThan(0)
    })
  })

  it('shows run lineage in failure card when multiple attempts exist', async () => {
    const run1 = { ...BASE_RUN, id: 'run_prev01', terminalState: 'stalled', stage: 'implement', failReason: 'heartbeat timeout' }
    const run2 = { ...BASE_RUN, id: 'run_abc123', terminalState: 'failed', stage: 'implement', failReason: 'retried by operator' }
    const { mock, restore } = mockFetch({
      '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project: BASE_PROJECT, spec: BASE_SPEC, task: BASE_TASK, run: run2 },
      '/api/attempts/run_abc123': attemptForRun(run2),
      '/api/specs/s1/tasks': [BASE_TASK, NEXT_TASK],
      '/api/tasks/t1/runs': [run1, run2],
      '/api/runs/run_abc123/evidence': [],
      '/api/runs/run_abc123/history': [],
      '/api/runs/run_abc123/gate-evaluations': [],
      '/api/runs/run_abc123/updates': [],
      '/api/runs/run_abc123/activity': [],
      '/api/decisions': [],
      '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
      '/api/factory': null,
    })
    cleanup = restore
    void mock
    renderWithProviders(
      <Routes><Route path="/:project/:spec/:task/:runId" element={<RunDetail />} /></Routes>,
      { route: '/ductum/impl-005/P1-TRIAGE/run_ab' },
    )
    await waitFor(() => {
      expect(screen.getByText('Failure Summary')).toBeInTheDocument()
      // Shows "you are here" for current run
      expect(screen.getByText(/you are here/)).toBeInTheDocument()
      // Shows attempt count
      expect(screen.getByText(/2 total/)).toBeInTheDocument()
    })
  })
})

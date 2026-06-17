import { fireEvent, screen, waitFor } from '@testing-library/react'
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

function renderRunDetail(stage: string, overrides: Record<string, unknown> = {}, activity: unknown[] = []) {
  const run = { ...BASE_RUN, stage, ...overrides }
  const { mock, restore } = mockFetch({
    '/api/resolve/ductum/impl-005/P1-TRIAGE/run_ab': { project: BASE_PROJECT, spec: BASE_SPEC, task: BASE_TASK, run },
    '/api/specs/s1/tasks': [BASE_TASK, NEXT_TASK],
    '/api/tasks/t1/runs': [run],
    '/api/runs/run_abc123/evidence': [],
    '/api/runs/run_abc123/history': [],
    '/api/runs/run_abc123/gate-evaluations': [],
    '/api/runs/run_abc123/updates': [],
    '/api/runs/run_abc123/activity': activity,
    '/api/runs/run_abc123/cancel': {
      schemaVersion: 1,
      kind: 'run.cancelled',
      data: {
        run: { ...run, terminalState: 'cancelled', recoverable: false },
        cost: { tokensIn: run.tokensIn, tokensOut: run.tokensOut, usd: run.costUsd },
        worktreePreserved: true,
        cleanupAt: null,
        evidenceId: 'evidence-cancel',
      },
      ts: new Date().toISOString(),
    },
    '/api/decisions': [],
    '/api/agents': [{ id: 'a1', name: 'Mimi', model: 'claude-opus-4-6', harness: 'claude-agent-sdk', capabilities: [], costTier: 1, spawnConfig: {}, createdAt: '' }],
    '/api/factory': null,
  })
  const result = renderWithProviders(
    <Routes><Route path="/:project/:spec/:task/:runId" element={<RunDetail />} /></Routes>,
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

  it('shows retry risk copy before retrying failed runs', async () => {
    const { restore } = renderRunDetail('implement', { terminalState: 'failed' })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText(/Retry only after inspecting logs and the target worktree/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Retry after inspection' })).toBeInTheDocument()
    })
  })

  it('shows cancel control for live runs and posts reason', async () => {
    const { mock, restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Operator cancel')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Cancel reason'), {
      target: { value: 'operator stopped duplicate work' },
    })
    fireEvent.click(screen.getByLabelText('Cleanup worktree'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel attempt' }))

    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        expect.stringContaining('/api/runs/run_abc123/cancel'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const call = mock.mock.calls.find(([url]) => String(url).includes('/api/runs/run_abc123/cancel'))
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      reason: 'operator stopped duplicate work',
      cleanupWorktree: true,
    })
  })

  it('shows approval panel only when pendingApproval is true', async () => {
    const { restore } = renderRunDetail('ship', { pendingApproval: true })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Approve & merge' }).length).toBeGreaterThan(0)
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    })
  })

  it('keeps approval action disabled with a reason when pendingApproval is false', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Running')).toBeInTheDocument()
    })
    const approve = screen.getByRole('button', { name: 'Approve & merge' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('title', 'Unlocks when this attempt reaches ship stage and waits for human approval.')
  })

  it('shows approval panel in ship stage', async () => {
    const { restore } = renderRunDetail('ship', { pendingApproval: true })
    cleanup = restore
    await waitFor(() => {
      expect(screen.getAllByText('Awaiting approval').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(/This attempt is ready to ship\./)).toBeInTheDocument()
  })

  it('uses Attempt copy on the detail surface', async () => {
    const { restore } = renderRunDetail('implement')
    cleanup = restore
    await waitFor(() => {
      expect(screen.getByText('Attempt detail')).toBeInTheDocument()
    })
    expect(screen.queryByText('Run detail')).not.toBeInTheDocument()
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

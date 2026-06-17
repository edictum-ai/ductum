/**
 * Approval recovery UX tests.
 *
 * Verifies the behavior contract from P17:
 *   - Failed approval leaves an operator-visible error on the card.
 *   - The UI shows the API-provided recovery guidance.
 *   - Stale-branch failures show deny/retry/rebase next steps.
 *   - A failed approval does NOT remove the card from the queue.
 *   - Successful approve/reject behavior keeps working.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalQueue } from '@/pages/ApprovalQueue'
import { ApprovalRow } from '@/components/approval/ApprovalRow'
import type { EnrichedRun } from '@/api/client'
import { mockFetch, renderWithProviders } from './test-utils'
import { isStaleError } from '@/lib/approval-recovery'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

function approvalRun(overrides: Record<string, unknown> = {}): EnrichedRun {
  const now = new Date().toISOString()
  return {
    id: 'run_ship_1',
    taskId: 'task1',
    agentId: 'agent1',
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feat/my-feature',
    commitSha: 'abc12345',
    prNumber: null,
    prUrl: null,
    worktreePaths: [],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 1.23,
    lastHeartbeat: now,
    heartbeatTimeoutSeconds: 300,
    completionSummary: 'Did the thing.',
    createdAt: now,
    updatedAt: now,
    taskName: 'Add feature',
    specName: 'impl-001',
    projectName: 'Ductum',
    agentName: 'Claude',
    agentModel: 'claude-sonnet-4-6',
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

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

// ─── isStaleError unit tests ───────────────────────────────────

describe('isStaleError', () => {
  it('detects stale keyword', () => {
    expect(isStaleError('branch is stale')).toBe(true)
  })
  it('detects behind keyword', () => {
    expect(isStaleError('branch is behind main by 3 commits')).toBe(true)
  })
  it('detects rebase keyword', () => {
    expect(isStaleError('rebase required before merge')).toBe(true)
  })
  it('detects not mergeable', () => {
    expect(isStaleError('branch is not mergeable')).toBe(true)
  })
  it('returns false for generic failures', () => {
    expect(isStaleError('permission denied')).toBe(false)
    expect(isStaleError('server error')).toBe(false)
  })
})

// ─── ApprovalQueue integration tests ──────────────────────────

describe('ApprovalQueue — approval failure recovery', () => {
  it('keeps the card visible and shows the error when approval returns success:false', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [approvalRun()],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
      '/api/runs/run_ship_1/approve': { success: false, reason: 'merge blocked: CI not green' },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Approve & merge'))

    await waitFor(() => {
      expect(screen.getByTestId('approval-failure-banner')).toBeInTheDocument()
    })

    // Error message from the API is surfaced to the operator.
    expect(screen.getByText('merge blocked: CI not green')).toBeInTheDocument()
    // The card must NOT be removed — decision 108, no fake success.
    expect(screen.getByText('Add feature')).toBeInTheDocument()
  })

  it('shows deny/retry/rebase guidance for stale-branch failures', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [approvalRun()],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
      '/api/runs/run_ship_1/approve': {
        success: false,
        reason: 'branch is stale — rebase required',
      },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Approve & merge'))

    await waitFor(() => {
      expect(screen.getByTestId('approval-failure-banner')).toBeInTheDocument()
    })

    const banner = screen.getByTestId('approval-failure-banner')
    // Stale-branch label surfaced in the banner header.
    expect(banner).toHaveTextContent(/stale branch/i)
    // Exact CLI commands visible without opening logs.
    expect(banner).toHaveTextContent(/ductum deny/)
    expect(banner).toHaveTextContent(/ductum retry/)
    // Branch name surfaced so operator knows where to rebase.
    expect(banner).toHaveTextContent(/feat\/my-feature/)
    // Card stays in queue — decision 108, no fake success.
    expect(screen.getByText('Add feature')).toBeInTheDocument()
  })

  it('clears the error when the operator retries the approval', async () => {
    let approveCall = 0
    const original = globalThis.fetch
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/runs?stage=ship'))
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve([approvalRun()]),
          text: () => Promise.resolve(JSON.stringify([approvalRun()])),
        } as Response)
      if (url.includes('/api/runs/run_ship_1/approve')) {
        approveCall += 1
        if (approveCall === 1)
          return Promise.resolve({
            ok: true, status: 200,
            json: () => Promise.resolve({ success: false, reason: 'not mergeable' }),
            text: () => Promise.resolve('{"success":false,"reason":"not mergeable"}'),
          } as Response)
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ success: true, stage: 'done' }),
          text: () => Promise.resolve('{"success":true,"stage":"done"}'),
        } as Response)
      }
      if (url.includes('/api/decisions'))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('[]') } as Response)
      if (url.includes('/api/telegram/status'))
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ enabled: false, webhookUrl: null }), text: () => Promise.resolve('{"enabled":false,"webhookUrl":null}') } as Response)
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('Not found') } as Response)
    })

    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    // First attempt — fails.
    fireEvent.click(screen.getByText('Approve & merge'))
    await waitFor(() => {
      expect(screen.getByTestId('approval-failure-banner')).toBeInTheDocument()
    })

    // Second attempt — error banner clears immediately on click.
    fireEvent.click(screen.getByText('Approve & merge'))
    await waitFor(() => {
      expect(screen.queryByTestId('approval-failure-banner')).not.toBeInTheDocument()
    })

    globalThis.fetch = original
  })
})

// ─── ApprovalRow unit tests ────────────────────────────────────

describe('ApprovalRow — failure banner props', () => {
  it('renders no banner when approvalError is null', () => {
    const run = approvalRun()
    renderWithProviders(
      <ApprovalRow
        run={run}
        evidence={[]}
        completionSummary={null}
        diff={null}
        approving={false}
        rejecting={false}
        exiting={false}
        approvalError={null}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('approval-failure-banner')).not.toBeInTheDocument()
  })

  it('renders banner with stale recovery commands when approvalError.isStale is true', () => {
    const run = approvalRun()
    renderWithProviders(
      <ApprovalRow
        run={run}
        evidence={[]}
        completionSummary={null}
        diff={null}
        approving={false}
        rejecting={false}
        exiting={false}
        approvalError={{
          runId: run.id,
          message: 'branch is stale',
          branch: 'feat/my-feature',
          isStale: true,
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    expect(screen.getByTestId('approval-failure-banner')).toBeInTheDocument()
    expect(screen.getByText(/ductum deny/)).toBeInTheDocument()
    expect(screen.getByText(/ductum retry/)).toBeInTheDocument()
    expect(screen.getByText(/feat\/my-feature/)).toBeInTheDocument()
  })
})

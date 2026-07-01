import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalQueue } from '@/pages/ApprovalQueue'
import { ApprovalRow } from '@/components/approval/ApprovalRow'
import type { EnrichedRun } from '@/api/client'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined
let restoreFetch: (() => void) | undefined

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
    branch: 'feat/x',
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

function mockLifecycleFetch(options: {
  initialRuns: unknown[]
  nextRuns: unknown[]
  mutationPath: string
  mutationBody: unknown
}) {
  const original = globalThis.fetch
  let shipCalls = 0
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    if (url.includes('/api/runs?stage=ship')) {
      shipCalls += 1
      return Promise.resolve(jsonResponse(shipCalls === 1 ? options.initialRuns : options.nextRuns))
    }
    if (url.includes('/api/decisions')) return Promise.resolve(jsonResponse([]))
    if (url.includes('/api/telegram/status')) return Promise.resolve(jsonResponse({ enabled: false, webhookUrl: null }))
    if (url.includes(options.mutationPath)) return Promise.resolve(jsonResponse(options.mutationBody))
    return Promise.resolve(notFoundResponse())
  })
  restoreFetch = () => {
    globalThis.fetch = original
  }
  return { getShipCalls: () => shipCalls }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response
}

function notFoundResponse(): Response {
  return {
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found'),
  } as Response
}

describe('ApprovalQueue', () => {
  afterEach(() => {
    fetchHelper?.restore()
    fetchHelper = undefined
    restoreFetch?.()
    restoreFetch = undefined
  })

  it('shows pending approval rows', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [approvalRun()],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
      expect(screen.getByText('decision awaiting you')).toBeInTheDocument()
    })
  })

  it('holds approved rows through the exit animation when the refetch removes them', async () => {
    const run = approvalRun()
    const lifecycle = mockLifecycleFetch({
      initialRuns: [run],
      nextRuns: [],
      mutationPath: '/api/runs/run_ship_1/approve',
      mutationBody: { success: true, stage: 'done', run: { ...run, pendingApproval: false } },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Approve & merge'))

    await waitFor(() => {
      expect(lifecycle.getShipCalls()).toBeGreaterThanOrEqual(2)
    })
    expect(screen.getByText('Add feature')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('Add feature')).not.toBeInTheDocument()
    }, { timeout: 1200 })
  })

  it('keeps rejected rows visible after a failed reject and shows the failure card', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [approvalRun()],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
      '/api/runs/run_ship_1/reject': { __status: 500, body: { error: 'Server error' } },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Reject'))
    fireEvent.change(await screen.findByPlaceholderText('Rejection reason...'), {
      target: { value: 'Not good enough' },
    })
    const rejectButtons = screen.getAllByText('Reject')
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!)

    await waitFor(() => {
      expect(screen.getByText('Reject failed')).toBeInTheDocument()
    })
    expect(screen.getByText('Add feature')).toBeInTheDocument()
  })

  it('holds rejected rows through the exit animation when the refetch removes them', async () => {
    const run = approvalRun()
    const lifecycle = mockLifecycleFetch({
      initialRuns: [run],
      nextRuns: [],
      mutationPath: '/api/runs/run_ship_1/reject',
      mutationBody: { ...run, pendingApproval: false },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Add feature')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Reject'))
    fireEvent.change(await screen.findByPlaceholderText('Rejection reason...'), {
      target: { value: 'Needs rework' },
    })
    const rejectButtons = screen.getAllByText('Reject')
    fireEvent.click(rejectButtons[rejectButtons.length - 1]!)

    await waitFor(() => {
      expect(lifecycle.getShipCalls()).toBeGreaterThanOrEqual(2)
    })
    expect(screen.getByText('Add feature')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('Add feature')).not.toBeInTheDocument()
    }, { timeout: 1200 })
  })

  it('renders recent decisions with human-friendly relative timestamps', async () => {
    const recentDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [],
      '/api/decisions': [
        {
          id: 'd1',
          decision: 'Approved merge',
          context: 'CI green, review passed',
          createdAt: recentDate,
        },
      ],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText(/ago$/)).toBeInTheDocument()
    })
    expect(screen.queryByText(recentDate)).not.toBeInTheDocument()
  })

  it('explains where approval actions appear when the queue is empty', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('No approval-ready attempts')).toBeInTheDocument()
    })
    expect(screen.getByText(/Approve and reject controls appear here/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Factory Activity' })).toHaveAttribute('href', '/activity')
    expect(screen.getByRole('link', { name: 'Open Repair' })).toHaveAttribute('href', '/repair')
  })

  it('shows Telegram status and the local CLI approval fallback', async () => {
    fetchHelper = mockFetch({
      '/api/runs?stage=ship': [],
      '/api/decisions': [],
      '/api/telegram/status': {
        enabled: true,
        configured: true,
        missing: [],
        webhookUrl: 'https://factory.arnoldcartagena.com/api/telegram/webhook',
      },
    })
    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    const status = await screen.findByTestId('telegram-approval-status')
    expect(status).toHaveTextContent('Telegram approvals active')
    expect(status).toHaveTextContent('https://factory.arnoldcartagena.com/api/telegram/webhook')
    expect(status).toHaveTextContent('ductum approve <attemptId>')
    expect(status).toHaveTextContent('ductum deny <attemptId> --reason <reason>')
  })

  it('opens the attempt when the approval title or breadcrumb is clicked', async () => {
    const onOpen = vi.fn()
    const run = approvalRun()

    renderWithProviders(
      <ApprovalRow
        run={run}
        evidence={[]}
        completionSummary="Ready to merge."
        diff={null}
        approving={false}
        rejecting={false}
        exiting={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onOpen={onOpen}
      />,
    )

    fireEvent.click(screen.getByText('Add feature'))
    fireEvent.click(screen.getByText('Ductum / impl-001'))
    expect(screen.getByRole('button', { name: 'Open attempt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open run' })).not.toBeInTheDocument()
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: run.id }))
  })
})

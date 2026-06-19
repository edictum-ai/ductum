import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RunControls } from '@/pages/run-detail/run-controls'
import type { RunType } from '@/pages/run-detail/types'

describe('RunControls', () => {
  it('requires a reason before retrying and passes the audited reason', () => {
    const onRetry = vi.fn()
    renderControls({ canRetry: true, onRetry })

    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).toBeDisabled()
    expect(screen.getByText('CLI: ductum retry run_abc123 --reason <text>')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'checked logs and reset the task' },
    })
    fireEvent.click(retry)

    expect(onRetry).toHaveBeenCalledWith({
      runId: 'run_abc123',
      reason: 'checked logs and reset the task',
    })
  })

  it('passes cancel reason and cleanup choice', () => {
    const onCancel = vi.fn()
    renderControls({ canCancel: true, onCancel })

    const cancel = screen.getByRole('button', { name: 'Cancel attempt' })
    expect(cancel).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'operator stopped duplicate work' },
    })
    fireEvent.click(screen.getByLabelText('Cleanup worktree'))
    fireEvent.click(cancel)

    expect(onCancel).toHaveBeenCalledWith({
      runId: 'run_abc123',
      reason: 'operator stopped duplicate work',
      cleanupWorktree: true,
    })
  })

  it('passes approval and rejection reasons', () => {
    const onApprove = vi.fn()
    const onReject = vi.fn()
    renderControls({ canApprove: true, canReject: true, onApprove, onReject })

    fireEvent.change(screen.getByLabelText('Operator reason'), {
      target: { value: 'reviewed CI and diff' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve & merge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(onApprove).toHaveBeenCalledWith({ runId: 'run_abc123', reason: 'reviewed CI and diff' })
    expect(onReject).toHaveBeenCalledWith({ runId: 'run_abc123', reason: 'reviewed CI and diff' })
  })

  it('approves with rebase without requiring a reason', () => {
    const onApproveRebase = vi.fn()
    renderControls({ canApproveRebase: true, onApproveRebase })

    const approveRebase = screen.getByRole('button', { name: 'Approve with rebase' })
    expect(approveRebase).toBeEnabled()
    expect(screen.getByText('CLI: ductum approve run_abc123 --rebase')).toBeInTheDocument()

    fireEvent.click(approveRebase)

    expect(onApproveRebase).toHaveBeenCalledWith('run_abc123')
  })
})

function renderControls(overrides: Partial<Parameters<typeof RunControls>[0]> = {}) {
  const noop = vi.fn()
  return render(
    <RunControls
      run={runFixture()}
      canApprove={false}
      canApproveRebase={false}
      canReject={false}
      canRetry={false}
      canCancel={false}
      approvePending={false}
      approveRebasePending={false}
      rejectPending={false}
      retryPending={false}
      cancelPending={false}
      approveError={null}
      approveRebaseError={null}
      rejectError={null}
      retryError={null}
      cancelError={null}
      onApprove={noop}
      onApproveRebase={noop}
      onReject={noop}
      onRetry={noop}
      onCancel={noop}
      {...overrides}
    />,
  )
}

function runFixture(): RunType {
  return {
    id: 'run_abc123',
    taskId: 't1',
    agentId: 'a1',
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
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
  } as RunType
}

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  canCleanupTerminalWorktree,
  isBudgetPaused,
  isTurnsDenyAllowed,
  isTurnsRecoverable,
  RunRecoveryControls,
} from '@/pages/run-detail/run-recovery-controls'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { RunType } from '@/pages/run-detail/types'

describe('RunRecoveryControls', () => {
  it('extends and denies budget-paused attempts', () => {
    const onBudgetExtend = vi.fn()
    const onBudgetDeny = vi.fn()
    renderControls({ run: runFixture({ failReason: 'cost_budget_paused: projected $31 >= $30' }), onBudgetExtend, onBudgetDeny })

    expect(screen.getByText('Recovery controls')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Extend budget' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Deny budget extension' })).toBeDisabled()
    expect(screen.getByText(/ductum attempt budget-extend run_abc123 --by <usd>/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Budget extension USD'), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Extend budget' }))
    expect(onBudgetExtend).toHaveBeenCalledWith({ runId: 'run_abc123', by: 12.5, reason: undefined })

    fireEvent.change(screen.getByLabelText('Budget reason'), { target: { value: 'operator accepts extra spend' } })
    fireEvent.click(screen.getByRole('button', { name: 'Deny budget extension' }))
    expect(onBudgetDeny).toHaveBeenCalledWith({ runId: 'run_abc123', reason: 'operator accepts extra spend' })
  })

  it('requires positive integer turn extensions and allows paused-turn denial', () => {
    const onTurnsExtend = vi.fn()
    const onTurnsDeny = vi.fn()
    renderControls({ run: runFixture({ failReason: 'max_turns_paused: hit 200 turns' }), onTurnsExtend, onTurnsDeny })

    const extend = screen.getByRole('button', { name: 'Extend turns' })
    const deny = screen.getByRole('button', { name: 'Deny turn extension' })
    expect(extend).toBeDisabled()
    expect(deny).toBeDisabled()
    expect(screen.getByText(/ductum attempt turns-extend run_abc123 --by <count>/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Turn extension count'), { target: { value: '10.5' } })
    expect(extend).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Turn extension count'), { target: { value: '25' } })
    fireEvent.click(extend)
    expect(onTurnsExtend).toHaveBeenCalledWith({ runId: 'run_abc123', by: 25, reason: undefined })

    fireEvent.change(screen.getByLabelText('Turns reason'), { target: { value: 'agent was mid-write' } })
    fireEvent.click(deny)
    expect(onTurnsDeny).toHaveBeenCalledWith({ runId: 'run_abc123', reason: 'agent was mid-write' })
  })

  it('renders nothing when no recoverable budget or turn reason is present', () => {
    const { container } = renderControls({ run: runFixture({ failReason: 'plain failure' }) })
    expect(container).toBeEmptyDOMElement()
  })

  it('closes a preserved failed-attempt worktree after trusted outcome cleanup', () => {
    const onCleanupWorktree = vi.fn()
    renderControls({
      run: runFixture({
        terminalState: 'failed',
        failReason: 'agent crashed before handoff',
        worktreePaths: ['/tmp/ductum/worktrees/run_abc123'],
      }),
      onCleanupWorktree,
    })

    expect(screen.getByText('Failed-attempt closeout')).toBeInTheDocument()
    expect(screen.getByText('worktrees/run_abc123')).toBeInTheDocument()
    expect(screen.getByText('worktrees/run_abc123')).toHaveAttribute('title', 'worktrees/run_abc123')
    expect(screen.queryByText('/tmp/ductum/worktrees/run_abc123')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show full paths' }))
    expect(screen.getByText('/tmp/ductum/worktrees/run_abc123')).toBeInTheDocument()
    expect(screen.getByText(/Cleanup requires a trusted task external outcome or merged sibling/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close preserved worktree' }))
    expect(onCleanupWorktree).toHaveBeenCalledWith('run_abc123')
  })

  it('closes a preserved cancelled-attempt worktree without trusted-outcome copy', () => {
    const onCleanupWorktree = vi.fn()
    renderControls({
      run: runFixture({
        terminalState: 'cancelled',
        failReason: null,
        worktreePaths: ['/tmp/ductum/worktrees/run_abc123'],
      }),
      onCleanupWorktree,
    })

    expect(screen.getByText('Cancelled-attempt closeout')).toBeInTheDocument()
    expect(screen.getByText(/records a superseded outcome/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close preserved worktree' }))
    expect(onCleanupWorktree).toHaveBeenCalledWith('run_abc123')
  })

  it('closes a preserved paused-attempt worktree from the dashboard', () => {
    const onCleanupWorktree = vi.fn()
    renderControls({
      run: runFixture({
        terminalState: 'paused',
        failReason: 'operator paused duplicate work',
        worktreePaths: ['/tmp/ductum/worktrees/run_abc123'],
      }),
      onCleanupWorktree,
    })

    expect(screen.getByText('Paused-attempt closeout')).toBeInTheDocument()
    expect(screen.getByText(/clears the paused attempt worktree paths/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close preserved worktree' }))
    expect(onCleanupWorktree).toHaveBeenCalledWith('run_abc123')
  })

  it('reports failed-attempt worktree cleanup success', () => {
    renderControls({
      run: runFixture({ terminalState: 'failed', worktreePaths: ['/tmp/wt'] }),
      cleanupWorktreeResult: {
        run: runFixture({ terminalState: 'failed', worktreePaths: null }),
        cleanupAt: '2026-06-30T12:00:00.000Z',
        externalOutcome: { runId: 'run_done', outcome: 'done', reason: 'sibling merged' },
        evidenceId: 'ev_cleanup',
        removedWorktreePaths: ['/tmp/wt'],
        generatedPaths: [],
        branchOutcomes: [],
      },
    })

    expect(screen.getByTestId('run-cleanup-worktree-result')).toHaveTextContent('closed · removed 1 worktree')
  })

  it('classifies recoverable fail reasons', () => {
    expect(isBudgetPaused('spec_cost_budget_paused: cap hit')).toBe(true)
    expect(isBudgetPaused('cost_budget_denied: no')).toBe(false)
    expect(isTurnsRecoverable('max_turns_reached')).toBe(true)
    expect(isTurnsRecoverable('max_turns_denied: no')).toBe(false)
    expect(isTurnsDenyAllowed('max_turns_paused: cap hit')).toBe(true)
    expect(isTurnsDenyAllowed('max_turns_reached')).toBe(false)
    expect(canCleanupTerminalWorktree(runFixture({ terminalState: 'failed', worktreePaths: ['/tmp/wt'] }))).toBe(true)
    expect(canCleanupTerminalWorktree(runFixture({ terminalState: 'cancelled', worktreePaths: ['/tmp/wt'] }))).toBe(true)
    expect(canCleanupTerminalWorktree(runFixture({ terminalState: 'paused', worktreePaths: ['/tmp/wt'] }))).toBe(true)
    expect(canCleanupTerminalWorktree(runFixture({ terminalState: 'stalled', worktreePaths: ['/tmp/wt'] }))).toBe(false)
  })
})

function renderControls(overrides: Partial<Parameters<typeof RunRecoveryControls>[0]> = {}) {
  const noop = vi.fn()
  return render(
    <TooltipProvider>
      <RunRecoveryControls
        run={runFixture({ failReason: 'cost_budget_paused: projected $31 >= $30' })}
        budgetExtendPending={false}
        budgetDenyPending={false}
        turnsExtendPending={false}
        turnsDenyPending={false}
        cleanupWorktreePending={false}
        budgetExtendError={null}
        budgetDenyError={null}
        turnsExtendError={null}
        turnsDenyError={null}
        cleanupWorktreeError={null}
        onBudgetExtend={noop}
        onBudgetDeny={noop}
        onTurnsExtend={noop}
        onTurnsDeny={noop}
        onCleanupWorktree={noop}
        {...overrides}
      />
    </TooltipProvider>,
  )
}

function runFixture(overrides: Partial<RunType> = {}): RunType {
  return {
    id: 'run_abc123',
    taskId: 't1',
    agentId: 'a1',
    parentRunId: null,
    stage: 'implement',
    terminalState: 'frozen',
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
    ...overrides,
  } as RunType
}

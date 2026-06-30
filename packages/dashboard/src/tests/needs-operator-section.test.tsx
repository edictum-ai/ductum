import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { NeedsOperatorSection } from '@/components/activity/NeedsOperatorSection'
import { TooltipProvider } from '@/components/ui/tooltip'

describe('NeedsOperatorSection', () => {
  it('does not claim the brief has action items when the reported count is clear', () => {
    render(
      <MemoryRouter>
        <NeedsOperatorSection attempts={[]} reportedCount={0} />
      </MemoryRouter>,
    )

    expect(screen.getByText('All clear · no attempts need operator action.')).toBeInTheDocument()
    expect(screen.queryByText(/operator brief row details/)).not.toBeInTheDocument()
  })

  it('uses shared status tones for quarantined and frozen rows', () => {
    render(
      <TooltipProvider>
        <MemoryRouter>
          <NeedsOperatorSection
            attempts={[
              runFixture({ id: 'run_quarantined', terminalState: 'quarantined', failReason: 'deterministic poison' }),
              runFixture({ id: 'run_frozen', terminalState: 'frozen', failReason: 'cost_budget_paused' }),
            ]}
            reportedCount={2}
          />
        </MemoryRouter>
      </TooltipProvider>,
    )

    expect(screen.getAllByText('Quarantined')[0]).toHaveClass('sig-tone-err')
    expect(screen.getAllByText('Frozen')[0]).toHaveClass('sig-tone-warn')
  })
})

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

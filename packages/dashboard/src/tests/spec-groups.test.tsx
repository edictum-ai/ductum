import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import type { EnrichedRun } from '@/api/client'
import { buildSpecGroups, SpecGroupCard } from '@/components/homepage/SpecGroups'

const now = '2026-06-15T12:00:00.000Z'

function run(overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    id: 'run_redacted_123456',
    taskId: 'task_redacted_123456',
    agentId: 'agent1',
    parentRunId: null,
    stage: 'done',
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
    lastHeartbeat: now,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
    taskName: '[redacted]',
    specName: '[redacted]',
    projectName: 'ductum',
    agentName: 'codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  }
}

describe('SpecGroupCard', () => {
  it('uses fallbacks instead of redacted visible labels', () => {
    const group = buildSpecGroups([run()])[0]!
    render(
      <MemoryRouter>
        <SpecGroupCard group={group} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: /Open ductum Spec run_re/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Expand Task task_r/ }))

    expect(screen.getAllByText(/Task task_r/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText('[redacted]')).toHaveLength(0)
  })
})

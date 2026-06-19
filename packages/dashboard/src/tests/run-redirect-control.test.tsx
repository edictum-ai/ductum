import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Agent } from '@/api/client'
import { RunRedirectControl } from '@/pages/run-detail/run-redirect-control'
import type { RunType } from '@/pages/run-detail/types'

describe('RunRedirectControl', () => {
  it('requires a target and reason before redirecting', () => {
    const onRedirect = vi.fn()
    render(
      <RunRedirectControl
        run={runFixture()}
        agents={[agentFixture('a1', 'mimi'), agentFixture('a2', 'codex')]}
        canRedirect={true}
        pending={false}
        error={null}
        onRedirect={onRedirect}
      />,
    )

    const button = screen.getByRole('button', { name: 'Redirect attempt' })
    expect(button).toBeDisabled()
    expect(screen.getByText('CLI: ductum attempt redirect run_abc123 --agent codex --reason <text>')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Redirect reason'), {
      target: { value: 'needs reviewer context' },
    })
    fireEvent.click(button)

    expect(onRedirect).toHaveBeenCalledWith({
      runId: 'run_abc123',
      agentId: 'a2',
      reason: 'needs reviewer context',
    })
  })

  it('submits the selected alternative agent', () => {
    const onRedirect = vi.fn()
    render(
      <RunRedirectControl
        run={runFixture()}
        agents={[
          agentFixture('a1', 'mimi'),
          agentFixture('a2', 'codex'),
          agentFixture('a3', 'glm'),
        ]}
        canRedirect={true}
        pending={false}
        error={null}
        onRedirect={onRedirect}
      />,
    )

    fireEvent.change(screen.getByLabelText('Redirect target agent'), {
      target: { value: 'a3' },
    })
    fireEvent.change(screen.getByLabelText('Redirect reason'), {
      target: { value: 'switch provider' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Redirect attempt' }))

    expect(onRedirect).toHaveBeenCalledWith({
      runId: 'run_abc123',
      agentId: 'a3',
      reason: 'switch provider',
    })
  })
})

function agentFixture(id: string, name: string): Agent {
  return {
    id,
    name,
    model: name === 'glm' ? 'glm-5.1' : 'gpt-5.4',
    harness: 'codex-sdk',
    capabilities: ['build'],
    costTier: 80,
    spawnConfig: {},
    createdAt: '2026-06-19T00:00:00.000Z',
  }
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

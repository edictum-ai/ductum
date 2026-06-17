import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { GateEvaluation, RunActivity } from '@/api/client'
import { RunDetailHero } from '@/pages/run-detail/hero'
import { GatesTab } from '@/pages/run-detail/evidence-tabs'

const now = '2026-06-15T12:00:00.000Z'

function gate(partial: Partial<GateEvaluation>): GateEvaluation {
  return {
    id: partial.id ?? 1,
    runId: 'run_abc123',
    gateType: partial.gateType ?? 'gate_check',
    target: partial.target ?? 'ship',
    result: partial.result ?? 'allowed',
    reason: partial.reason ?? null,
    observed: partial.observed ?? false,
    createdAt: partial.createdAt ?? now,
  }
}

function activity(partial: Partial<RunActivity> = {}): RunActivity {
  return {
    id: partial.id ?? 1,
    runId: 'run_abc123',
    kind: partial.kind ?? 'text',
    content: partial.content ?? 'working',
    toolName: partial.toolName ?? null,
    createdAt: partial.createdAt ?? now,
  }
}

describe('RunDetail gate visibility', () => {
  it('lists every gate evaluation with gate, target, result, and reason', () => {
    render(<GatesTab gates={[
      gate({ id: 1, gateType: 'read_before_edit', target: 'implement', result: 'allowed', reason: null }),
      gate({ id: 2, gateType: 'gate_check', target: 'ship', result: 'blocked', reason: 'CI evidence is missing' }),
      gate({ id: 3, gateType: 'authorize_tool', target: 'Write', result: 'blocked', reason: 'write requires approval', observed: true }),
    ]} />)

    expect(screen.getByText('3 total')).toBeInTheDocument()
    expect(screen.getByText('read_before_edit')).toBeInTheDocument()
    expect(screen.getByText('gate_check')).toBeInTheDocument()
    expect(screen.getByText('authorize_tool')).toBeInTheDocument()
    expect(screen.getByText('implement')).toBeInTheDocument()
    expect(screen.getByText('ship')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
    expect(screen.getByText('No reason recorded')).toBeInTheDocument()
    expect(screen.getByText('CI evidence is missing')).toBeInTheDocument()
    expect(screen.getByText('write requires approval')).toBeInTheDocument()
    expect(screen.getByText('blocked (observed)')).toBeInTheDocument()
  })

  it('shows disabled action reasons inline in the hero', () => {
    render(
      <RunDetailHero
        run={{
          id: 'run_abc123',
          taskId: 't1',
          agentId: 'a1',
          parentRunId: null,
          sessionId: 'sess_1',
          branch: null,
          commitSha: null,
          prNumber: null,
          prUrl: null,
          ciStatus: null,
          reviewStatus: null,
          failReason: null,
          recoverable: true,
          terminalState: null,
          resetCount: 0,
          completedStages: [],
          blockedReason: null,
          pendingApproval: false,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          lastHeartbeat: now,
          heartbeatTimeoutSeconds: 120,
          completionSummary: null,
          worktreePaths: null,
          createdAt: now,
          updatedAt: now,
          stage: 'implement',
        }}
        taskTitle="P1-TRIAGE"
        summaryText=""
        statusLabel="Running"
        toneColor="#38bdf8"
        running
        approval={false}
        needsApproval={false}
        canRetry={false}
        approvePending={false}
        retryPending={false}
        activity={[]}
        onApprove={() => undefined}
        onRetry={() => undefined}
      />,
    )

    expect(screen.getByText(/Approve & merge disabled: Unlocks when this attempt reaches ship stage/)).toBeInTheDocument()
    expect(screen.getByText(/Retry after inspection disabled: Unlocks for recoverable failed or stalled attempts/)).toBeInTheDocument()
    expect(screen.getByText(/Transcript disabled: Unlocks when attempt activity has been recorded/)).toBeInTheDocument()
  })

  it('does not show the transcript disabled reason once activity exists', () => {
    render(
      <RunDetailHero
        run={{
          id: 'run_abc123', taskId: 't1', agentId: 'a1', parentRunId: null,
          sessionId: 'sess_1', branch: null, commitSha: null, prNumber: null, prUrl: null,
          ciStatus: null, reviewStatus: null, failReason: null, recoverable: true,
          terminalState: 'failed', resetCount: 0, completedStages: [], blockedReason: null,
          pendingApproval: false, tokensIn: 0, tokensOut: 0, costUsd: 0,
          lastHeartbeat: now, heartbeatTimeoutSeconds: 120, completionSummary: null,
          worktreePaths: null, createdAt: now, updatedAt: now, stage: 'implement',
        }}
        taskTitle="P1-TRIAGE"
        summaryText=""
        statusLabel="Failed"
        toneColor="#f87171"
        running={false}
        approval={false}
        needsApproval={false}
        canRetry
        approvePending={false}
        retryPending={false}
        activity={[activity()]}
        onApprove={() => undefined}
        onRetry={() => undefined}
      />,
    )

    expect(screen.queryByText(/Transcript disabled:/)).not.toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { Run, RunActivity } from '@/api/client'
import { FailureSummaryCard } from '@/components/run/FailureSummaryCard'

const RUN = {
  id: 'run_abc123',
  taskId: 't1',
  agentId: 'a1',
  parentRunId: null,
  sessionId: 'sess_1',
  branch: 'feat/test',
  commitSha: null,
  prNumber: null,
  prUrl: null,
  ciStatus: null,
  reviewStatus: null,
  failReason: 'edit failed',
  recoverable: true,
  terminalState: 'failed',
  resetCount: 0,
  completedStages: [],
  blockedReason: null,
  pendingApproval: false,
  tokensIn: 1000,
  tokensOut: 100,
  costUsd: 0.01,
  stage: 'implement',
  lastHeartbeat: new Date().toISOString(),
  heartbeatTimeoutSeconds: 120,
  completionSummary: null,
  worktreePaths: null,
  createdAt: new Date(Date.now() - 3600000).toISOString(),
  updatedAt: new Date().toISOString(),
} as Run

describe('FailureSummaryCard', () => {
  it('hides internal tool payload ids in the last action', () => {
    const activity: RunActivity[] = [{
      id: 1,
      runId: RUN.id,
      kind: 'tool_call',
      toolName: 'Edit',
      content: JSON.stringify({
        threadId: 'thread_123',
        turnId: 'turn_123',
        itemId: 'item_123',
        args: {
          file_path: '/project/ductum/packages/core/src/enforce.ts',
          old_string: 'before',
          new_string: 'after',
        },
      }),
      createdAt: new Date(Date.now() - 180000).toISOString(),
    }]

    render(
      <MemoryRouter>
        <FailureSummaryCard
          run={RUN}
          activity={activity}
          siblingRuns={[RUN]}
          projectName="ductum"
          specName="impl-005"
          taskName="P1-TRIAGE"
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Failure Summary')).toBeInTheDocument()
    expect(screen.getByText('Edit file')).toBeInTheDocument()
    expect(screen.getByText(/packages\/core\/src\/enforce\.ts \(edit\)/)).toBeInTheDocument()
    expect(screen.queryByText(/threadId|thread_123|turnId|turn_123|itemId|item_123/)).not.toBeInTheDocument()
  })

  it('redacts and truncates long command metadata in the last action', () => {
    const command = `TOKEN=super-secret-value node scripts/release-check.mjs --project ductum --profile production --notes ${'verify '.repeat(8)}`
    const activity: RunActivity[] = [{
      id: 2,
      runId: RUN.id,
      kind: 'tool_call',
      toolName: 'Bash',
      content: JSON.stringify({ command }),
      createdAt: new Date(Date.now() - 180000).toISOString(),
    }]

    render(
      <MemoryRouter>
        <FailureSummaryCard
          run={RUN}
          activity={activity}
          siblingRuns={[RUN]}
          projectName="ductum"
          specName="impl-005"
          taskName="P1-TRIAGE"
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Run command')).toBeInTheDocument()
    expect(screen.getByText(/TOKEN=\[redacted\]/)).toHaveTextContent('...')
    expect(screen.queryByText(command)).not.toBeInTheDocument()
    expect(screen.queryByText(/super-secret-value/)).not.toBeInTheDocument()
  })

  it.each([
    ['quoted token env var', 'TOKEN="super-secret-value" node scripts/check.mjs', /TOKEN=\[redacted\]/, /super-secret-value/],
    ['authorization bearer header', 'curl -H "Authorization: Bearer sk-super-secret" https://example.test', /Authorization: Bearer \[redacted\]/i, /sk-super-secret/],
    ['token-only URL userinfo', 'git ls-remote https://ghp_super_secret@github.com/acme/repo', /https:\/\/\[redacted\]@github\.com/, /ghp_super_secret/],
    ['token username URL userinfo', 'git ls-remote https://ghp_super_secret:x-oauth-basic@github.com/acme/repo', /https:\/\/\[redacted\]@github\.com/, /ghp_super_secret/],
  ])('redacts %s command metadata', (_name, command, expected, secret) => {
    const activity: RunActivity[] = [{
      id: 3,
      runId: RUN.id,
      kind: 'tool_call',
      toolName: 'Bash',
      content: JSON.stringify({ command }),
      createdAt: new Date(Date.now() - 180000).toISOString(),
    }]

    render(
      <MemoryRouter>
        <FailureSummaryCard
          run={RUN}
          activity={activity}
          siblingRuns={[RUN]}
          projectName="ductum"
          specName="impl-005"
          taskName="P1-TRIAGE"
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.queryByText(secret)).not.toBeInTheDocument()
  })
})

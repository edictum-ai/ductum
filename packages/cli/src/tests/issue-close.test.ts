import { describe, expect, it, vi } from 'vitest'

import { DuctumApiError } from '../api-client.js'
import { createMockApi, readyTask, runCommand, spec } from './helpers.js'

const closeResult = {
  recordType: 'GitHubIssueCloseout' as const,
  run: {
    id: 'run-close-1',
    taskId: readyTask.id,
    agentId: 'agent-1',
    parentRunId: null,
    stage: 'done' as const,
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement', 'ship'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: 'feat/p1-issue-closeout',
    commitSha: 'abc123',
    prNumber: 81,
    prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
    worktreePaths: null,
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-07-04T12:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: '2026-07-04T11:00:00.000Z',
    updatedAt: '2026-07-04T12:00:00.000Z',
  },
  issue: {
    number: 12,
    url: 'https://github.com/edictum-ai/ductum/issues/12',
    repository: 'edictum-ai/ductum',
  },
  comment: {
    url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-202',
    id: 202,
  },
  pr: {
    number: 81,
    url: 'https://github.com/edictum-ai/ductum/pull/81',
  },
  merge: {
    commitSha: 'merge9876543210abcdef',
    baseBranch: 'main',
    requiredChecksSource: 'branch_protection',
  },
  actor: {
    type: 'github_app',
    label: 'GitHub App 123 installation 456',
  },
  operatorAction: 'operator-approved: historical closeout',
  evidence: {
    id: 'evidence-close-1',
    runId: 'run-close-1',
    type: 'custom' as const,
    payload: {
      kind: 'github-issue-resolution',
      repo: 'edictum-ai/ductum',
      issueNumber: 12,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
      commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-202',
      commentId: 202,
      prNumber: 81,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
      runId: 'run-close-1',
      headSha: 'abc123',
      mergeCommitSha: 'merge9876543210abcdef',
      requiredChecksSource: 'branch_protection',
      operatorAction: 'operator-approved: historical closeout',
      actorType: 'github_app',
      actorLabel: 'GitHub App 123 installation 456',
    },
    createdAt: '2026-07-04T12:00:00.000Z',
  },
}

describe('issue close command', () => {
  it('closes an issue through GitHub App auth and prints issue/comment/actor/run evidence', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockResolvedValue(closeResult),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
      '--reason',
      'operator-approved: historical closeout',
    ], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('issue: edictum-ai/ductum#12')
    expect(result.text).toContain('issueUrl: https://github.com/edictum-ai/ductum/issues/12')
    expect(result.text).toContain('runId: run-close-1')
    expect(result.text).toContain('runStage: done')
    expect(result.text).toContain('pr: 81')
    expect(result.text).toContain('prUrl: https://github.com/edictum-ai/ductum/pull/81')
    expect(result.text).toContain('commentUrl: https://github.com/edictum-ai/ductum/issues/12#issuecomment-202')
    expect(result.text).toContain('mergeCommit: merge9876543210abcdef')
    expect(result.text).toContain('requiredChecksSource: branch_protection')
    expect(result.text).toContain('actorType: github_app')
    expect(result.text).toContain('actorLabel: GitHub App 123 installation 456')
    expect(result.text).toContain('operatorAction: operator-approved: historical closeout')
    expect(result.text).toContain('evidenceId: evidence-close-1')
    expect(result.text).not.toContain('app-token')
    expect(result.text).not.toContain('Bearer ')
    expect(api.closeGitHubIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      issueRef: '12',
      runId: 'run-close-1',
      operatorAction: 'operator-approved: historical closeout',
    })
  })

  it('passes --repository through to the API when provided', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockResolvedValue(closeResult),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
      '--repository',
      'ductum',
    ], api)

    expect(result.code).toBe(0)
    expect(api.closeGitHubIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      repository: 'ductum',
      issueRef: '12',
      runId: 'run-close-1',
    })
  })

  it('rejects an unknown --repository before calling the API', async () => {
    const api = createMockApi({
      listRepositories: vi.fn().mockResolvedValue([]),
      closeGitHubIssue: vi.fn().mockResolvedValue(closeResult),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
      '--repository',
      'missing',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Repository not found in project ductum: missing')
    expect(api.closeGitHubIssue).not.toHaveBeenCalled()
  })

  it('requires --run', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockResolvedValue(closeResult),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--run')
    expect(api.closeGitHubIssue).not.toHaveBeenCalled()
  })

  it('surfaces API validation errors as operator-visible failures', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockImplementation(() => {
        throw new DuctumApiError('Run run-close-1 is stage ship; issue closeout requires stage "done"', 400)
      }),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('issue closeout requires stage "done"')
  })

  it('omits operatorAction from the request when --reason is blank', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockResolvedValue({
        ...closeResult,
        operatorAction: null,
      }),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
      '--reason',
      '   ',
    ], api)

    expect(result.code).toBe(0)
    expect(api.closeGitHubIssue).toHaveBeenCalledWith({
      projectId: 'project-1',
      issueRef: '12',
      runId: 'run-close-1',
    })
    expect(result.text).toContain('operatorAction: ')
  })
})

describe('issue close command — provenance separation', () => {
  it('keeps the GitHub App actor and the operator action distinct in the printed output', async () => {
    const api = createMockApi({
      closeGitHubIssue: vi.fn().mockImplementation((input: { operatorAction?: string }) =>
        Promise.resolve({ ...closeResult, operatorAction: input.operatorAction ?? null })),
    })

    const result = await runCommand([
      'issue',
      'close',
      'ductum',
      '12',
      '--run',
      'run-close-1',
      '--reason',
      'arnold approved retroactive closeout',
    ], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('actorLabel: GitHub App 123 installation 456')
    expect(result.text).toContain('actorType: github_app')
    expect(result.text).toContain('operatorAction: arnold approved retroactive closeout')
    // The operator reason must not be echoed as if it were the GitHub actor.
    expect(result.text).not.toContain('actorLabel: arnold')
  })
})

describe('issue close command — spec fixture sanity', () => {
  it('the imported mock fixture has the expected shape', () => {
    expect(spec.id).toBe('spec-1')
    expect(closeResult.run.stage).toBe('done')
    expect(closeResult.recordType).toBe('GitHubIssueCloseout')
  })
})

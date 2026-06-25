import { describe, expect, it, vi } from 'vitest'

import { createMockApi, runCommand } from './helpers.js'

describe('attempt cleanup command', () => {
  it('requires --worktree and calls the cleanup endpoint', async () => {
    const api = createMockApi()
    const result = await runCommand([
      '--json',
      'attempt',
      'cleanup',
      'run-123',
      '--worktree',
    ], api)

    expect(result.code).toBe(0)
    expect(api.cleanupRunWorktree).toHaveBeenCalledWith('run-123')
    expect(JSON.parse(result.text)).toMatchObject({
      cleanupAt: expect.any(String),
      removedWorktreePaths: ['/tmp/ductum-worktree'],
      branchOutcomes: [expect.objectContaining({ branch: 'ductum/rest-api', outcome: 'removed' })],
    })
  })

  it('renders human cleanup summary', async () => {
    const api = createMockApi({
      cleanupRunWorktree: vi.fn().mockResolvedValue({
        run: {
          id: 'run-123',
          taskId: 'task-1',
          agentId: 'agent-1',
          parentRunId: null,
          stage: 'implement',
          terminalState: 'failed',
          resetCount: 0,
          completedStages: [],
          blockedReason: null,
          pendingApproval: false,
          sessionId: null,
          branch: 'ductum/rest-api',
          commitSha: null,
          prNumber: null,
          prUrl: null,
          worktreePaths: null,
          ciStatus: null,
          reviewStatus: null,
          failReason: 'original failure',
          recoverable: false,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          lastHeartbeat: '2026-05-01T12:00:00.000Z',
          heartbeatTimeoutSeconds: 120,
          createdAt: '2026-05-01T12:00:00.000Z',
          updatedAt: '2026-05-01T12:00:00.000Z',
        },
        cleanupAt: '2026-05-03T12:00:00.000Z',
        externalOutcome: {
          runId: 'run-done',
          outcome: 'fixed' as const,
          reason: 'operator fixed it elsewhere',
        },
        removedWorktreePaths: ['/tmp/ductum-worktree'],
        generatedPaths: [{
          path: '/tmp/.codex-home/run-123',
          outcome: 'removed' as const,
          reason: 'removed generated Codex home',
        }],
        branchOutcomes: [{
          branch: 'ductum/rest-api',
          outcome: 'removed' as const,
          reason: 'removed local Ductum auto branch',
          repoPath: '/tmp/repo',
          worktreePath: '/tmp/ductum-worktree',
        }],
        evidenceId: 'evidence-cleanup',
      }),
    })
    const result = await runCommand([
      '--human',
      'attempt',
      'cleanup',
      'run-123',
      '--worktree',
    ], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('attempt: ')
    expect(result.text).toContain('result: Failed')
    expect(result.text).toContain('cleanedWorktrees: 1')
    expect(result.text).toContain('removedBranches: 1')
  })

  it('rejects missing --worktree', async () => {
    const result = await runCommand(['attempt', 'cleanup', 'run-123'])

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('required option missing: --worktree')
  })
})

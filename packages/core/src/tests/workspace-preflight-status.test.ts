import { describe, expect, it, vi } from 'vitest'

import { assertWorkspacePreflightForDispatch, runDispatcherPreflight } from '../dispatcher-preflight.js'
import { runWorkspacePreflight } from '../workspace-preflight.js'
import type { Task } from '../types.js'
import type { WorkspacePreflightProbes } from '../workspace-preflight-types.js'

describe('workspace preflight status semantics', () => {
  it('marks omitted optional checks as skipped instead of pass', () => {
    const result = runWorkspacePreflight({
      config: { env: ['API_TOKEN'] },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes(),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(true)
    expect(statuses(result.checks)).toMatchObject({
      'package-manager': 'skipped',
      'runtime-version': 'skipped',
      dependencies: 'skipped',
      'worktree-writable': 'pass',
      'worktree-state': 'skipped',
      'env-refs': 'pass',
      'native-tools': 'skipped',
      'sandbox-mode': 'skipped',
    })
  })

  it('fails configured container PATH tool probes when no sandbox probe exists', () => {
    const result = runWorkspacePreflight({
      config: {
        packageManager: 'pnpm',
        runtime: { name: 'node' },
        dependencies: { packageManager: 'pnpm' },
        nativeTools: ['git'],
        sandbox: { mode: 'container' },
        worktree: { writable: false },
      },
      workingDir: '/repo',
      sandboxMode: 'container',
      hasSandboxProfile: true,
      hasInheritedWorktree: false,
      probes: probes({ hasBinary: () => false }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(false)
    expect(statuses(result.checks)).toMatchObject({
      'package-manager': 'fail',
      'runtime-version': 'fail',
      dependencies: 'fail',
      'native-tools': 'fail',
      'sandbox-mode': 'pass',
    })
  })

  it('treats host sandbox profiles as host dispatch preflight mode', () => {
    const result = assertWorkspacePreflightForDispatch({
      taskRepo: {} as never,
      taskDispatchSkipRepo: undefined,
    }, {
      config: { packageManager: 'pnpm', sandbox: { mode: 'host' }, worktree: { writable: false } },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: true,
      hasInheritedWorktree: false,
      probes: probes(),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(true)
    expect(statuses(result.checks)).toMatchObject({
      'package-manager': 'pass',
      'sandbox-mode': 'pass',
    })
  })

  it('checks configured lockfiles during setup-scope preflight', () => {
    const result = runWorkspacePreflight({
      config: { dependencies: { packageManager: 'pnpm', lockfile: 'pnpm-lock.yaml', installDir: 'node_modules' } },
      workingDir: '/repo',
      scope: 'setup',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ exists: (path) => path !== '/repo/pnpm-lock.yaml' }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(false)
    expect(statuses(result.checks)).toMatchObject({ dependencies: 'fail' })
    if (!result.ok) expect(result.issues[0]?.reason).toContain('pnpm-lock.yaml')
  })

  it('blocks dispatch when a preflight override returns failure', () => {
    const currentTask = task()
    const taskRepo = { updateStatus: vi.fn() }
    const taskDispatchSkipRepo = { record: vi.fn() }
    const failing = runWorkspacePreflight({
      config: { env: ['MISSING_TOKEN'] },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ envValue: () => undefined }),
      task: currentTask,
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(() => runDispatcherPreflight({
      taskRepo: taskRepo as never,
      taskDispatchSkipRepo: taskDispatchSkipRepo as never,
    }, {
      override: () => failing,
      probes: undefined,
      task: currentTask,
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      config: { env: ['MISSING_TOKEN'] },
      hostEnv: {},
      now: new Date('2026-07-08T00:00:00Z'),
    })).toThrow('MISSING_TOKEN')
    expect(taskRepo.updateStatus).toHaveBeenCalledWith(currentTask.id, 'blocked')
    expect(taskDispatchSkipRepo.record).toHaveBeenCalledWith(expect.objectContaining({ taskId: currentTask.id }))
  })
})

function statuses(checks: Array<{ id: string; status: string }>): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.id, check.status]))
}

function probes(overrides: Partial<WorkspacePreflightProbes> = {}): WorkspacePreflightProbes {
  return {
    hasBinary: overrides.hasBinary ?? (() => true),
    binaryVersion: overrides.binaryVersion ?? (() => 'v22.3.0'),
    exists: overrides.exists ?? (() => true),
    isWritable: overrides.isWritable ?? (() => true),
    worktreeStatus: overrides.worktreeStatus ?? (() => ({ clean: true, error: null })),
    envValue: overrides.envValue ?? ((name) => name === 'API_TOKEN' ? 'resolved-secret' : undefined),
  }
}

function task(): Task {
  return {
    id: 'task-preflight-status' as Task['id'],
    specId: 'spec-preflight-status' as Task['specId'],
    targetId: null,
    name: 'preflight status task',
    prompt: 'run preflight',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: [],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: '2026-07-08T00:00:00Z',
    updatedAt: '2026-07-08T00:00:00Z',
  }
}

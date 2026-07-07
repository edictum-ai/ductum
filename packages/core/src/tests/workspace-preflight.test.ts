import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { PREREQUISITE_BLOCKED_SKIP_REASON } from '../dispatcher-prerequisite-block.js'
import {
  assertWorkspacePreflightForDispatch,
  WorkspacePreflightFailedError,
} from '../dispatcher-preflight.js'
import { createHostPreflightProbes, runWorkspacePreflight } from '../workspace-preflight.js'
import type { TaskRepo } from '../repos/interfaces.js'
import type { TaskDispatchSkipRepo } from '../repos/task-dispatch-skip.js'
import type { Task } from '../types.js'
import { parseWorkflowProfile } from '../workflow-renderer.js'
import type { WorkspacePreflightProbes } from '../workspace-preflight-types.js'

describe('workspace hydration preflight', () => {
  it('passes configured green checks without exposing env values', () => {
    const result = runWorkspacePreflight({
      config: {
        packageManager: 'pnpm',
        runtime: { name: 'node', minVersion: '22.0.0' },
        dependencies: { lockfile: 'pnpm-lock.yaml', installDir: 'node_modules', packageManager: 'pnpm' },
        worktree: { writable: true, expect: 'clean' },
        env: ['DUCTUM_OPERATOR_TOKEN'],
        nativeTools: ['git'],
        sandbox: { mode: 'host' },
      },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ env: { DUCTUM_OPERATOR_TOKEN: 'sk-secret-value' } }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(true)
    expect(result.checks.map((check) => check.status)).not.toContain('fail')
    expect(JSON.stringify(result.checks)).not.toContain('sk-secret-value')
  })

  it('reports missing dependency install state with exact repair text', () => {
    const result = runWorkspacePreflight({
      config: { dependencies: { installDir: 'node_modules' } },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ exists: (path) => path !== '/repo/node_modules' }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.issueCode).toBe('preflight_dependencies')
    expect(result.issues[0]?.reason).toContain('node_modules')
    expect(result.issues[0]?.suggestedAction).toContain('pnpm install --frozen-lockfile')
  })

  it('reports inaccessible and dirty worktree states', () => {
    const inaccessible = runWorkspacePreflight({
      config: { worktree: { writable: true } },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ isWritable: () => false }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })
    const dirty = runWorkspacePreflight({
      config: { worktree: { expect: 'clean' } },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ worktreeStatus: () => ({ clean: false, error: null }) }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(inaccessible.ok).toBe(false)
    expect(dirty.ok).toBe(false)
    if (!inaccessible.ok) expect(inaccessible.issues[0]?.issueCode).toBe('preflight_worktree_writable')
    if (!dirty.ok) expect(dirty.issues[0]?.issueCode).toBe('preflight_worktree_state')
    if (!dirty.ok) expect(dirty.issues[0]?.reason).toContain('untracked files')
  })

  it('host clean-worktree probe treats untracked files as dirty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-preflight-'))
    try {
      execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
      writeFileSync(join(dir, 'untracked.txt'), 'dirty\n')
      expect(createHostPreflightProbes({}).worktreeStatus(dir)).toEqual({ clean: false, error: null })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('host clean-worktree probe fails outside Git worktrees', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ductum-preflight-nongit-'))
    try {
      expect(createHostPreflightProbes({}).worktreeStatus(dir)).toEqual({ clean: false, error: 'path is not inside a Git worktree' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports missing env refs without printing secret values', () => {
    const result = runWorkspacePreflight({
      config: { env: ['API_TOKEN'] },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ env: { API_TOKEN: '' } }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.issueCode).toBe('preflight_env_refs')
    expect(result.issues[0]?.reason).toContain('API_TOKEN')
    expect(result.issues[0]?.reason).not.toContain('secret')
  })

  it('reports missing native tools and sandbox mode mismatches', () => {
    const missingTool = runWorkspacePreflight({
      config: { nativeTools: ['podman'] },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes({ hasBinary: (name) => name !== 'podman' }),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })
    const missingSandbox = runWorkspacePreflight({
      config: { sandbox: { mode: 'container' } },
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      probes: probes(),
      task: task(),
      now: new Date('2026-07-08T00:00:00Z'),
    })

    expect(missingTool.ok).toBe(false)
    expect(missingSandbox.ok).toBe(false)
    if (!missingTool.ok) expect(missingTool.issues[0]?.issueCode).toBe('preflight_native_tools')
    if (!missingSandbox.ok) expect(missingSandbox.issues[0]?.issueCode).toBe('preflight_sandbox_mode')
  })

  it('blocks dispatch through the prerequisite Needs Attention path', () => {
    const current = task()
    const taskRepo = {
      updateStatus: vi.fn((_id: Task['id'], status: Task['status']) => ({ ...current, status })),
    } as unknown as TaskRepo
    const taskDispatchSkipRepo = { record: vi.fn(), get: vi.fn(), list: vi.fn(), clear: vi.fn() } as unknown as TaskDispatchSkipRepo

    expect(() => assertWorkspacePreflightForDispatch({ taskRepo, taskDispatchSkipRepo }, {
      task: current,
      workingDir: '/repo',
      sandboxMode: 'host',
      hasSandboxProfile: false,
      hasInheritedWorktree: false,
      config: { packageManager: 'pnpm' },
      probes: probes({ hasBinary: () => false }),
      now: new Date('2026-07-08T00:00:00Z'),
    })).toThrow(WorkspacePreflightFailedError)

    expect(taskRepo.updateStatus).toHaveBeenCalledWith(current.id, 'blocked')
    expect(taskDispatchSkipRepo.record).toHaveBeenCalledWith(expect.objectContaining({
      taskId: current.id,
      reason: PREREQUISITE_BLOCKED_SKIP_REASON,
      detail: expect.stringContaining('Attempt start blocked by prerequisite checks.'),
    }))
  })

  it('parses workflow profile preflight config and rejects malformed fields', () => {
    const profile = parseWorkflowProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata:
  name: repo-coding
context:
  required_files: [README.md]
verify:
  commands: [pnpm test]
push:
  protected_branches: [main]
preflight:
  packageManager: pnpm
  runtime:
    name: node
    minVersion: "22.0.0"
  dependencies:
    lockfile: pnpm-lock.yaml
    installDir: node_modules
  worktree:
    writable: true
    expect: clean
  env: [DUCTUM_OPERATOR_TOKEN]
  nativeTools: [git]
  sandbox:
    mode: host
`, 'test-profile.yaml')

    expect(profile.preflight).toMatchObject({
      packageManager: 'pnpm',
      runtime: { name: 'node', minVersion: '22.0.0' },
      worktree: { writable: true, expect: 'clean' },
      sandbox: { mode: 'host' },
    })
    expect(() => parseWorkflowProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata: { name: bad }
context: { required_files: [README.md] }
verify: { commands: [pnpm test] }
push: { protected_branches: [main] }
preflight:
  sandbox:
    mode: vm
`, 'bad-profile.yaml')).toThrow('bad-profile.yaml.preflight.sandbox.mode must be one of host, container, any')
    expect(() => parseWorkflowProfile(`
apiVersion: edictum/v1alpha1
kind: WorkflowProfile
metadata: { name: bad }
context: { required_files: [README.md] }
verify: { commands: [pnpm test] }
push: { protected_branches: [main] }
preflight:
  surprise: true
`, 'bad-profile.yaml')).toThrow('bad-profile.yaml.preflight.surprise is not supported')
  })
})

function probes(overrides: Partial<WorkspacePreflightProbes> & { env?: Record<string, string> } = {}): WorkspacePreflightProbes {
  const env = overrides.env ?? { DUCTUM_OPERATOR_TOKEN: 'set' }
  return {
    hasBinary: overrides.hasBinary ?? (() => true),
    binaryVersion: overrides.binaryVersion ?? (() => 'v22.3.0'),
    exists: overrides.exists ?? (() => true),
    isWritable: overrides.isWritable ?? (() => true),
    worktreeStatus: overrides.worktreeStatus ?? (() => ({ clean: true, error: null })),
    envValue: overrides.envValue ?? ((name) => {
      const value = env[name]
      return value == null || value === '' ? undefined : value
    }),
  }
}

function task(): Task {
  return {
    id: 'task-preflight' as Task['id'],
    specId: 'spec-preflight' as Task['specId'],
    targetId: null,
    name: 'preflight task',
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

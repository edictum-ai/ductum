import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import {
  createFixture,
  createId,
  createTask,
  describe,
  expect,
  it,
  vi,
  type Run,
  type WorktreeManager,
} from './shared.js'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeWorktreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-inherited-'))
  tempDirs.push(dir)
  return dir
}

function fakeWorktreeManager(worktree: string) {
  return {
    get enabled() { return true },
    get cleanupOnSuccess() { return true },
    get cleanupOnFailure() { return true },
    isGitRepo: () => true,
    create: vi.fn(async () => worktree),
    remove: vi.fn(async () => undefined),
    restore: vi.fn(async () => worktree),
    cleanupStale: vi.fn(async () => 0),
  } as unknown as WorktreeManager
}

/**
 * Build a failed impl run on `name` with a preserved worktree path. The
 * caller controls whether the path exists on disk and whether the run
 * carries a restorable branch/commit ref.
 */
function seedFailedImplRun(
  fixture: ReturnType<typeof createFixture>,
  name: string,
  options: {
    worktreePath: string
    branch?: string | null
    commitSha?: string | null
  },
): { task: ReturnType<typeof createTask>; run: Run } {
  const task = createTask(fixture, { name, status: 'done', assignedAgentId: fixture.builder.id })
  const run = fixture.context.runRepo.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: fixture.builder.id,
    parentRunId: null,
    stage: 'done',
    terminalState: 'failed',
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'impl-session',
    branch: options.branch ?? null,
    commitSha: options.commitSha ?? null,
    prNumber: null,
    prUrl: null,
    worktreePaths: [options.worktreePath],
    ciStatus: null,
    reviewStatus: null,
    failReason: 'harness_failed',
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: fixture.nowRef.value,
    heartbeatTimeoutSeconds: 120,
  })
  return { task, run }
}

describe('Dispatcher - inherited worktree atomicity', () => {
  it('blocks a review task before run creation when the preserved worktree is missing without a restorable ref', async () => {
    const fixture = createFixture({
      resolveRepoPath: () => '/tmp/base',
      worktreeManager: fakeWorktreeManager('/tmp/ductum-inherited-missing'),
    })
    // Source run is terminal (failed) with a missing worktree path and no
    // branch/commit ref for restore.
    seedFailedImplRun(fixture, 'P1', { worktreePath: '/tmp/ductum-inherited-missing' })
    const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toEqual([])
    expect(result.errors[0]?.error).toContain('Inherited worktree is missing')
    // No child run was created for the review task.
    expect(fixture.context.runRepo.list(reviewTask.id)).toEqual([])
    // Task is blocked, not active.
    expect(fixture.context.taskRepo.get(reviewTask.id)?.status).toBe('blocked')
    // Prerequisite dispatch skip was recorded with the prerequisite-blocked
    // reason so the cycle retains the skip record on the next loop.
    expect(fixture.context.taskDispatchSkipRepo.get(reviewTask.id)).toMatchObject({
      reason: 'prerequisite-blocked',
      detail: expect.stringContaining('Inherited worktree is missing'),
    })
    // No reviewer harness spawn occurred.
    expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
    expect(fixture.builderHarness.adapter.spawn).not.toHaveBeenCalled()
  })

  it('dispatches successfully when the worktree manager can restore the inherited worktree from a branch ref', async () => {
    const worktree = makeWorktreeDir()
    // Mirror the restore contract: manager.restore() must recreate the path
    // on disk so the post-preflight existence check passes.
    const manager = fakeWorktreeManager(worktree)
    const fixture = createFixture({
      resolveRepoPath: () => '/tmp/base',
      worktreeManager: manager,
    })
    seedFailedImplRun(fixture, 'P3', {
      worktreePath: '/tmp/ductum-inherited-restorable',
      branch: 'feat/P3',
    })
    const reviewTask = createTask(fixture, { name: 'review-P3', requiredRole: 'reviewer' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toContain(reviewTask.id)
    expect(result.errors).toEqual([])
    expect(fixture.context.runRepo.list(reviewTask.id)[0]?.worktreePaths).toEqual([worktree])
    expect(manager.restore).toHaveBeenCalled()
    expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalled()
  })

  it('dispatches successfully when the inherited worktree path is still live on disk', async () => {
    const worktree = makeWorktreeDir()
    expect(existsSync(worktree)).toBe(true)
    const fixture = createFixture({
      resolveRepoPath: () => '/tmp/base',
      worktreeManager: fakeWorktreeManager(worktree),
    })
    seedFailedImplRun(fixture, 'P4', { worktreePath: worktree })
    const reviewTask = createTask(fixture, { name: 'review-P4', requiredRole: 'reviewer' })

    const result = await fixture.dispatcher.cycle()

    expect(result.tasksDispatched).toContain(reviewTask.id)
    expect(result.errors).toEqual([])
    expect(fixture.context.runRepo.list(reviewTask.id)[0]?.worktreePaths).toEqual([worktree])
    expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalled()
  })

  it('does not fire the gate for a non-terminal source run that still owns its worktree session', async () => {
    // Live source runs (no terminalState) still own their worktree; the
    // atomicity contract targets preserved worktrees only.
    const worktree = makeWorktreeDir()
    const fixture = createFixture({
      resolveRepoPath: () => '/tmp/base',
      worktreeManager: fakeWorktreeManager(worktree),
    })
    const task = createTask(fixture, { name: 'P5', status: 'active', assignedAgentId: fixture.builder.id })
    fixture.context.runRepo.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: fixture.builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'live-impl',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: [worktree],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: fixture.nowRef.value,
      heartbeatTimeoutSeconds: 120,
    })
    const reviewTask = createTask(fixture, { name: 'review-P5', requiredRole: 'reviewer' })

    // Worktree contention path blocks dispatch through the live-session
    // check, not the missing-worktree gate. The gate must not produce the
    // missing-worktree error here.
    await fixture.dispatcher.cycle()
    const skip = fixture.context.taskDispatchSkipRepo.get(reviewTask.id)
    if (skip != null) {
      expect(skip.detail).not.toContain('Inherited worktree is missing')
    }
    expect(fixture.context.taskRepo.get(reviewTask.id)?.status).not.toBe('blocked')
  })
})

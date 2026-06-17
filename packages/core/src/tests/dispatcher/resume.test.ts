import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import {
  createFixture,
  createTask,
  expect,
  describe,
  flush,
  it,
  vi,
  type Run,
  type WorktreeManager,
} from './shared.js'
import type { WorkflowStage } from '../../types.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A worktree dir that really exists so resolveInheritedWorktree rebinds it. */
function makeWorktreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-resume-'))
  tempDirs.push(dir)
  return dir
}

/** Minimal WorktreeManager fake: create() yields a real reusable dir. */
function fakeWorktreeManager(worktree: string) {
  const remove = vi.fn(async () => undefined)
  const create = vi.fn(async () => worktree)
  const manager = {
    get enabled() { return true },
    get cleanupOnSuccess() { return true },
    get cleanupOnFailure() { return true },
    isGitRepo: () => true,
    create,
    remove,
    restore: vi.fn(async () => worktree),
    cleanupStale: vi.fn(async () => 0),
  } as unknown as WorktreeManager
  return { manager, remove, create }
}

/** Drive a run from a fresh dispatch up to a stage with a written checkpoint. */
async function dispatchToStage(
  fixture: ReturnType<typeof createFixture>,
  stage: WorkflowStage,
): Promise<Run> {
  await fixture.dispatcher.cycle()
  const run = fixture.context.runRepo.list(fixture.context.taskRepo.list(fixture.spec.id)[0]!.id)[0]!
  if (stage !== 'understand') {
    fixture.context.runRepo.updateStage(run.id, stage)
    fixture.stateMachine.recordStageAdvance(run.id, 'understand', stage, 'progress')
  }
  return fixture.context.runRepo.get(run.id)!
}

function otherRun(fixture: ReturnType<typeof createFixture>, taskId: Run['taskId'], excludeId: Run['id']): Run {
  return fixture.context.runRepo.list(taskId).find((r) => r.id !== excludeId)!
}

describe('Dispatcher - checkpoint resume (design/04 §1)', () => {
  it('resumes a crashed run at its checkpoint stage on the SAME worktree (not a fresh understand run)', async () => {
    const worktree = makeWorktreeDir()
    const { manager, remove } = fakeWorktreeManager(worktree)
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: manager, resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    // Dispatch + advance the agent to `implement` (writes a checkpoint).
    const crashedRun = await dispatchToStage(fixture, 'implement')
    expect(crashedRun.worktreePaths).toEqual([worktree])
    expect(fixture.context.runCheckpointRepo.get(crashedRun.id)?.stage).toBe('implement')

    // Crash mid-implement.
    fixture.builderHarness.sessions[0]!.done.resolve({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await flush()

    // The crash is auto-retried AND the worktree is preserved for the resume.
    const retried = fixture.context.taskRepo.get(task.id)!
    expect(retried.status).toBe('ready')
    expect(retried.retryCount).toBe(1)
    expect(remove).not.toHaveBeenCalled()
    expect(existsSync(worktree)).toBe(true)
    expect(fixture.context.runRepo.get(crashedRun.id)?.terminalState).toBe('stalled')

    // Past the backoff → the next cycle RESUMES instead of dispatching fresh.
    fixture.nowRef.value = new Date(new Date(retried.retryAfter!).getTime() + 1_000).toISOString()
    const result = await fixture.dispatcher.cycle()
    expect(result.tasksDispatched).toContain(task.id)

    const resumed = otherRun(fixture, task.id, crashedRun.id)
    expect(resumed.id).not.toBe(crashedRun.id)
    expect(resumed.stage).toBe('implement') // resumed at checkpoint, NOT 'understand'
    expect(resumed.worktreePaths).toEqual([worktree]) // SAME worktree
    expect(seedWorkflowStage).toHaveBeenCalledWith(resumed.id, 'implement')
  })

  it('falls back to a fresh understand run + cleans the worktree when no checkpoint exists', async () => {
    const worktree = makeWorktreeDir()
    const { manager, remove } = fakeWorktreeManager(worktree)
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: manager, resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    // Crash at `understand` — no advance, so no checkpoint was ever written.
    const crashedRun = await dispatchToStage(fixture, 'understand')
    expect(fixture.context.runCheckpointRepo.get(crashedRun.id)).toBeNull()

    fixture.builderHarness.sessions[0]!.done.resolve({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await flush()

    // Today's behavior: worktree is cleaned up, task re-readied for a fresh run.
    expect(remove).toHaveBeenCalledWith(worktree)
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('ready')

    fixture.nowRef.value = new Date(new Date(fixture.context.taskRepo.get(task.id)!.retryAfter!).getTime() + 1_000).toISOString()
    await fixture.dispatcher.cycle()
    const fresh = otherRun(fixture, task.id, crashedRun.id)
    expect(fresh.stage).toBe('understand')
    expect(seedWorkflowStage).not.toHaveBeenCalled()
  })

  it('does NOT resume a rollback-required stage (ship): falls back to fresh', async () => {
    const worktree = makeWorktreeDir()
    const { manager } = fakeWorktreeManager(worktree)
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: manager, resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    const crashedRun = await dispatchToStage(fixture, 'ship')
    expect(fixture.context.runCheckpointRepo.get(crashedRun.id)?.stage).toBe('ship')

    fixture.builderHarness.sessions[0]!.done.resolve({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await flush()

    fixture.nowRef.value = new Date(new Date(fixture.context.taskRepo.get(task.id)!.retryAfter!).getTime() + 1_000).toISOString()
    await fixture.dispatcher.cycle()
    const fresh = otherRun(fixture, task.id, crashedRun.id)
    expect(fresh.stage).toBe('understand')
    expect(seedWorkflowStage).not.toHaveBeenCalled()
  })

  it('does NOT resume a non-first stage without a seed hook (cannot seed Edictum forward)', async () => {
    const worktree = makeWorktreeDir()
    const { manager } = fakeWorktreeManager(worktree)
    // No seedWorkflowStage provided.
    const fixture = createFixture({ worktreeManager: manager, resolveRepoPath: () => '/tmp/base' })
    const task = createTask(fixture)

    const crashedRun = await dispatchToStage(fixture, 'implement')
    expect(fixture.context.runCheckpointRepo.get(crashedRun.id)?.stage).toBe('implement')

    fixture.builderHarness.sessions[0]!.done.resolve({ exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0 })
    await flush()

    fixture.nowRef.value = new Date(new Date(fixture.context.taskRepo.get(task.id)!.retryAfter!).getTime() + 1_000).toISOString()
    await fixture.dispatcher.cycle()
    const fresh = otherRun(fixture, task.id, crashedRun.id)
    expect(fresh.stage).toBe('understand')
  })
})

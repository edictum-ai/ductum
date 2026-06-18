import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import {
  createFixture,
  createTask,
  describe,
  expect,
  flush,
  it,
  vi,
  type Run,
  type WorktreeManager,
} from './shared.js'
import type { HarnessSessionResult } from '../../dispatcher-support.js'
import type { WorkflowStage } from '../../types.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeWorktreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-recov-'))
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

/** Drain the async dispatch chain (createMcpServer → spawn → record). */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

async function dispatchToStage(fixture: ReturnType<typeof createFixture>, stage: WorkflowStage): Promise<Run> {
  await fixture.dispatcher.cycle()
  const run = fixture.context.runRepo.list(fixture.context.taskRepo.list(fixture.spec.id)[0]!.id)[0]!
  if (stage !== 'understand') {
    fixture.context.runRepo.updateStage(run.id, stage)
    fixture.stateMachine.recordStageAdvance(run.id, 'understand', stage, 'progress')
  }
  return fixture.context.runRepo.get(run.id)!
}

function latestRun(fixture: ReturnType<typeof createFixture>, taskId: Run['taskId'], excludeId: Run['id']): Run {
  return fixture.context.runRepo.list(taskId).find((r) => r.id !== excludeId)!
}

const recoverableExternal = (detail: string, evidence?: Record<string, unknown>): HarnessSessionResult => ({
  exitReason: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0, failReason: detail, failureEvidence: { category: 'recoverable-external', ...evidence },
})

describe('Dispatcher - operator pause/resume + limits policy (design/04 §1,§5)', () => {
  it('operator pause → resume continues at the checkpoint stage on the same worktree (not a restart)', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    const run = await dispatchToStage(fixture, 'implement')
    expect(run.worktreePaths).toEqual([worktree])

    const paused = await fixture.dispatcher.pause(run.id, 'operator paused')
    expect(paused.terminalState).toBe('paused')
    expect(existsSync(worktree)).toBe(true) // worktree preserved for resume

    const resumed = await fixture.dispatcher.resume(run.id)
    expect(resumed.id).not.toBe(run.id)
    expect(resumed.stage).toBe('implement') // continues, not restart at understand
    expect(resumed.worktreePaths).toEqual([worktree])
    expect(seedWorkflowStage).toHaveBeenCalledWith(resumed.id, 'implement')
  })

  it('operator resume at ship falls back to a fresh understand run', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    createTask(fixture)

    const run = await dispatchToStage(fixture, 'ship')
    const paused = await fixture.dispatcher.pause(run.id, 'operator paused at ship')
    expect(paused.terminalState).toBe('paused')
    expect(fixture.context.runCheckpointRepo.get(run.id)?.stage).toBe('ship')

    const resumed = await fixture.dispatcher.resume(run.id)
    expect(resumed.stage).toBe('understand')
    expect(seedWorkflowStage).not.toHaveBeenCalled()
  })

  it('rejects a second resume while the task already has a live continuation', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    createTask(fixture)

    const run = await dispatchToStage(fixture, 'implement')
    await fixture.dispatcher.pause(run.id, 'operator paused')
    await fixture.dispatcher.resume(run.id)

    await expect(fixture.dispatcher.resume(run.id)).rejects.toThrow(/already has an active run/)
  })

  it('out-of-credits WITH a different-provider fallback → fails over and continues', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage, recordEvidence: true })
    // The reviewer (vercel-ai) is also enabled as a builder → a different provider.
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 insufficient_quota: out of credits'))
    await settle()

    // The exhausted run is terminal; a continuation runs on the other provider.
    expect(fixture.context.runRepo.get(run.id)?.terminalState).toBe('failed')
    const failover = latestRun(fixture, task.id, run.id)
    expect(failover.agentId).toBe(fixture.reviewer.id) // different provider/builder
    expect(failover.stage).toBe('implement') // continued, not restarted
    expect(failover.worktreePaths).toEqual([worktree])
    expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalled()
    expect(seedWorkflowStage).toHaveBeenCalledWith(failover.id, 'implement')
  })

  it('out-of-credits failover freezes when the retry budget is exhausted', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage, recordEvidence: true, maxTaskRetries: 0 })
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 insufficient_quota: out of credits'))
    await settle()

    const frozen = fixture.context.runRepo.get(run.id)!
    expect(frozen.terminalState).toBe('frozen')
    expect(frozen.failReason).toMatch(/retry budget exhausted/)
    expect(fixture.context.taskRepo.get(task.id)?.retryCount).toBe(1)
    expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
  })

  it('failed failover dispatch leaves the source frozen and recoverable', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage, recordEvidence: true })
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    fixture.reviewerHarness.adapter.spawn.mockRejectedValueOnce(new Error('fallback adapter unavailable'))
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 insufficient_quota: out of credits'))
    await settle()

    const source = fixture.context.runRepo.get(run.id)!
    expect(source.terminalState).toBe('frozen')
    expect(source.recoverable).toBe(true)
    expect(source.failReason).toMatch(/failover pending/)
    expect(fixture.context.taskRepo.get(task.id)?.retryCount).toBe(1)
  })

  it('out-of-credits with NO fallback → frozen + resumable, not failed', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 out of credits'))
    await settle()

    const frozen = fixture.context.runRepo.get(run.id)!
    expect(frozen.terminalState).toBe('frozen') // not 'failed'
    expect(frozen.recoverable).toBe(true)
    expect(existsSync(worktree)).toBe(true)

    // Resumable on demand: operator resume continues from the checkpoint.
    const resumed = await fixture.dispatcher.resume(run.id)
    expect(resumed.stage).toBe('implement')
    expect(resumed.worktreePaths).toEqual([worktree])
  })

  it('operator resume of provider-frozen run rematches to a newly available fallback', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 out of credits'))
    await settle()

    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    const resumed = await fixture.dispatcher.resume(run.id)
    expect(resumed.agentId).toBe(fixture.reviewer.id)
    expect(resumed.stage).toBe('implement')
    expect(resumed.worktreePaths).toEqual([worktree])
    expect(task.assignedAgentId).toBe(fixture.builder.id)
  })

  it('transient (429 with retry-after) → waits the provider hint then auto-resumes', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve({
      exitReason: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      failReason: '429 rate limit', failureEvidence: { category: 'transient', retryAfterSeconds: 5 },
    })
    await settle()

    const stalled = fixture.context.runRepo.get(run.id)!
    expect(stalled.terminalState).toBe('stalled')
    const t = fixture.context.taskRepo.get(task.id)!
    expect(t.status).toBe('ready')
    // Backoff honors the provider's retry-after (5s), not the default schedule.
    expect(new Date(t.retryAfter!).getTime() - new Date(fixture.nowRef.value).getTime()).toBe(5_000)

    // Past the wait → auto-resume from the checkpoint.
    fixture.nowRef.value = new Date(new Date(t.retryAfter!).getTime() + 1_000).toISOString()
    await fixture.dispatcher.cycle()
    const resumed = latestRun(fixture, task.id, run.id)
    expect(resumed.stage).toBe('implement')
    expect(resumed.worktreePaths).toEqual([worktree])
  })

  it('budget pause → frozen, then resumes from checkpoint (unifies the existing pause)', async () => {
    const worktree = makeWorktreeDir()
    const seedWorkflowStage = vi.fn(async () => undefined)
    const fixture = createFixture({ worktreeManager: fakeWorktreeManager(worktree), resolveRepoPath: () => '/tmp/base', seedWorkflowStage })
    const task = createTask(fixture)

    const run = await dispatchToStage(fixture, 'implement')
    fixture.builderHarness.sessions[0]!.done.resolve({
      exitReason: 'paused-cost-budget', tokensIn: 0, tokensOut: 0, costUsd: 0,
      pauseDetail: { detail: 'cap $30 reached', cap: 30 },
    })
    await settle()

    const frozen = fixture.context.runRepo.get(run.id)!
    expect(frozen.terminalState).toBe('frozen')
    expect(frozen.failReason).toMatch(/^cost_budget_paused/)

    const resumed = await fixture.dispatcher.resume(run.id)
    expect(resumed.stage).toBe('implement') // resume from checkpoint, not understand
    expect(resumed.worktreePaths).toEqual([worktree])
  })

  it('terminal failure (context overflow) still fails with evidence (no resume)', async () => {
    const fixture = createFixture({ recordEvidence: true })
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    fixture.builderHarness.sessions[0]!.done.resolve({
      exitReason: 'failed', tokensIn: 0, tokensOut: 0, costUsd: 0, failReason: '400 context length exceeded',
    })
    await settle()
    expect(fixture.context.runRepo.list(task.id)[0]?.terminalState).toBe('failed')
  })
})

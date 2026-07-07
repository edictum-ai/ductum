import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vitest'

import { buildDispatcherSystemPrompt } from '../../dispatcher-support.js'
import { createFixture, createTask, describe, expect, flush, it, vi, type WorktreeManager } from './shared.js'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeWorktreeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ductum-overflow-retry-'))
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

describe('Dispatcher - prompt_overflow retry budget (#282)', () => {
  it('threads prior prompt_overflow telemetry into the resumed run system prompt', async () => {
    // The resume path must populate DispatchOptions.priorAttemptFailure so
    // the retried agent gets explicit read-budget guidance and does not
    // blindly re-read the same huge files.
    const worktree = makeWorktreeDir()
    const fixture = createFixture({
      recordEvidence: true,
      worktreeManager: fakeWorktreeManager(worktree),
      resolveRepoPath: () => worktree,
      seedWorkflowStage: vi.fn(async () => undefined),
      buildSystemPrompt: (task, _run, context) => buildDispatcherSystemPrompt(task, { workingDir: worktree, ...(context?.priorAttemptFailure != null ? { priorAttemptFailure: context.priorAttemptFailure } : {}) }),
    })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    // Dispatch the first attempt.
    await fixture.dispatcher.cycle()
    const firstRun = fixture.context.runRepo.list(task.id)[0]!
    // Advance to implement so the worktree is checkpointed and resumable.
    fixture.context.runRepo.updateStage(firstRun.id, 'implement')
    fixture.stateMachine.recordStageAdvance(firstRun.id, 'understand', 'implement', 'progress')
    fixture.context.runCheckpointRepo.upsert({
      runId: firstRun.id,
      taskId: task.id,
      stage: 'implement',
      completedStages: ['understand'],
      worktreePaths: [worktree],
    })

    // Resolve the first attempt's session with a prompt_overflow failure
    // shaped like Claude harness + applyAttemptResourceCeilings: frozen with
    // a max_turns_paused reason and the overflow token tally persisted.
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        reason: 'prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
        source: 'activity',
        observedContext: {
          tokensIn: 9_760_000,
          maxInputTokensInTurn: 205_000,
          turns: 37,
          costUsd: 3.76,
        },
      },
      tokensIn: 9_760_000,
      tokensOut: 120_000,
      costUsd: 3.76,
      turns: 37,
      maxInputTokensInTurn: 205_000,
    })
    await flush()

    const frozen = fixture.context.runRepo.get(firstRun.id)!
    expect(frozen.terminalState).toBe('frozen')
    expect(frozen.tokensIn).toBe(9_760_000)

    // Operator resume: should spawn a new run with the prior failure
    // threaded into the system prompt.
    const resumed = await fixture.dispatcher.resume(firstRun.id)
    expect(resumed.id).not.toBe(firstRun.id)
    expect(resumed.stage).toBe('implement')

    const spawnCall = fixture.builderHarness.adapter.spawn.mock.calls.find(
      (call) => call[0]?.id === resumed.id,
    )
    expect(spawnCall).toBeDefined()
    const systemPrompt = String(spawnCall![2])
    // The retry must surface the prior overflow reason and explicit
    // read-budget guidance so it does not replay the same death.
    expect(systemPrompt).toContain('## Previous Attempt Failure')
    expect(systemPrompt).toContain('prompt overflow')
    expect(systemPrompt).toContain('Use `Read` with `offset` and `limit`')
    expect(systemPrompt).toContain('205,000 input tokens in a single turn')
    expect(systemPrompt).not.toContain('9,760,000')
  })

  it('threads prior prompt_overflow telemetry into a fresh retry when the old worktree is gone', async () => {
    const worktree = makeWorktreeDir()
    const fixture = createFixture({
      recordEvidence: true,
      worktreeManager: fakeWorktreeManager(worktree),
      resolveRepoPath: () => worktree,
      seedWorkflowStage: vi.fn(async () => undefined),
      buildSystemPrompt: (task, _run, context) => buildDispatcherSystemPrompt(task, { workingDir: worktree, ...(context?.priorAttemptFailure != null ? { priorAttemptFailure: context.priorAttemptFailure } : {}) }),
    })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await fixture.dispatcher.cycle()
    const firstRun = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateStage(firstRun.id, 'implement')
    fixture.stateMachine.recordStageAdvance(firstRun.id, 'understand', 'implement', 'progress')
    fixture.context.runCheckpointRepo.upsert({
      runId: firstRun.id,
      taskId: task.id,
      stage: 'implement',
      completedStages: ['understand'],
      worktreePaths: [join(worktree, 'deleted')],
    })

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        reason: 'prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
        source: 'activity',
        observedContext: {
          tokensIn: 4_200_000,
          maxInputTokensInTurn: 910_000,
          turns: 18,
        },
      },
      tokensIn: 4_200_000,
      tokensOut: 30_000,
      costUsd: 1.42,
      turns: 18,
      maxInputTokensInTurn: 910_000,
    })
    await flush()

    const resumed = await fixture.dispatcher.resume(firstRun.id)
    expect(resumed.id).not.toBe(firstRun.id)

    const spawnCall = fixture.builderHarness.adapter.spawn.mock.calls.find(
      (call) => call[0]?.id === resumed.id,
    )
    expect(spawnCall).toBeDefined()
    const systemPrompt = String(spawnCall![2])
    expect(systemPrompt).toContain('## Previous Attempt Failure')
    expect(systemPrompt).toContain('prompt overflow')
    expect(systemPrompt).toContain('Use `Read` with `offset` and `limit`')
    expect(systemPrompt).toContain('910,000 input tokens in a single turn')
  })

  it('resume after operator pause (no failure) does not add the prior-failure section', async () => {
    const worktree = makeWorktreeDir()
    const fixture = createFixture({
      worktreeManager: fakeWorktreeManager(worktree),
      resolveRepoPath: () => worktree,
      seedWorkflowStage: vi.fn(async () => undefined),
      buildSystemPrompt: (task, _run, context) => buildDispatcherSystemPrompt(task, { workingDir: worktree, ...(context?.priorAttemptFailure != null ? { priorAttemptFailure: context.priorAttemptFailure } : {}) }),
    })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await fixture.dispatcher.cycle()
    const firstRun = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateStage(firstRun.id, 'implement')
    fixture.stateMachine.recordStageAdvance(firstRun.id, 'understand', 'implement', 'progress')

    // Operator pause (no failure) - resume should not warn about overflow.
    await fixture.dispatcher.pause(firstRun.id, 'operator paused')
    const resumed = await fixture.dispatcher.resume(firstRun.id)

    const spawnCall = fixture.builderHarness.adapter.spawn.mock.calls.find(
      (call) => call[0]?.id === resumed.id,
    )
    expect(spawnCall).toBeDefined()
    const systemPrompt = String(spawnCall![2])
    expect(systemPrompt).not.toContain('## Previous Attempt Failure')
    expect(systemPrompt).not.toContain('prompt_overflow')
    expect(systemPrompt).not.toContain('prompt overflow')
  })
})

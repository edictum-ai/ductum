import { createFixture, createTask, describe, expect, flush, it, vi } from './shared.js'

describe('Dispatcher - completion failure precedence', () => {
  it('preserves an earlier worker failure instead of routing post-completion on later teardown', async () => {
    const onReadyToShip = vi.fn(async () => undefined)
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        onReadyToShip: onReadyToShip as never,
      },
    })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      failReason: 'codex app-server error: {"code":500,"message":"boom"}',
      failureEvidence: { category: 'terminal', kind: 'codex-app-server-error', detail: { code: 500, message: 'boom' } },
    })
    await flush()

    await fixture.dispatcher.endSession(run.id)
    await flush()

    expect(onReadyToShip).not.toHaveBeenCalled()
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: 'failed',
      failReason: 'codex app-server error: {"code":500,"message":"boom"}',
      pendingApproval: false,
    })
  })
})

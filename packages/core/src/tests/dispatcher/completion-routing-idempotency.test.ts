import { createFixture, createTask, deferred, describe, expect, flush, it, vi } from './shared.js'

describe('Dispatcher - completion routing idempotency', () => {
  it('does not double-route when stored-completion nudges arrive during routing', async () => {
    const fixture = createFixture()
    const task = createTask(fixture)
    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])
    const routeGate = deferred<void>()
    const runPostCompletionPipeline = vi
      .spyOn(fixture.dispatcher.router, 'runImplCompletion')
      .mockImplementation(async () => routeGate.promise)

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()
    await flush()
    expect(runPostCompletionPipeline).toHaveBeenCalledTimes(1)

    await fixture.dispatcher.routeStoredCompletion(run.id)
    expect(runPostCompletionPipeline).toHaveBeenCalledTimes(1)

    routeGate.resolve()
    await flush()
    expect(runPostCompletionPipeline).toHaveBeenCalledTimes(1)
    runPostCompletionPipeline.mockRestore()
  })
})

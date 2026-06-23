import { createFixture, createTask, describe, expect, flush, it, vi, type PostCompletionConfig } from './shared.js'

describe('Dispatcher - completion follow-up cycle', () => {
  it('dispatches post-completion review follow-ups without waiting for the next poll', async () => {
    vi.useFakeTimers()
    let fixtureRef: ReturnType<typeof createFixture>
    const postCompletion: PostCompletionConfig = {
      resolveVerifyCommands: () => [],
      resolveReviewerAgent: () => fixtureRef.reviewer.id as never,
      maxReviewRounds: 3,
    }
    const fixture = createFixture({ pollIntervalMs: 60_000, postCompletion })
    fixtureRef = fixture
    const task = createTask(fixture)

    fixture.dispatcher.start()
    await flush()
    await vi.waitFor(() => expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledTimes(1))
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.context.runRepo.updateWorktreePaths(run.id, ['/tmp/impl-worktree'])

    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'completed',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()

    await vi.waitFor(() => expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalledTimes(1))
    const reviewTask = fixture.context.taskRepo.list(fixture.spec.id).find((candidate) => candidate.name === `review-${task.name}`)
    expect(reviewTask?.status).toBe('active')
    fixture.dispatcher.stop()
  })
})

import { createFixture, createRun, createTask, describe, expect, it } from './shared.js'

describe('PostCompletionRouter failed root lineage guard', () => {
  it('continues fix routing when the root task is done because the root failed', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveReviewerAgent: (agentId) => agentId,
      },
    })
    const implTask = createTask(fixture, { name: 'P1', status: 'done' })
    const implRun = createRun(fixture, implTask, {
      stage: 'done',
      terminalState: 'failed',
      worktreePaths: ['/tmp/wt'],
    })
    const fixTask = createTask(fixture, { name: 'fix-P1-r1', status: 'active' })
    const fixRun = createRun(fixture, fixTask, { parentRunId: implRun.id, worktreePaths: ['/tmp/wt'] })

    await fixture.router.runFixCompletion(fixRun)

    const tasks = fixture.ctx.taskRepo.list(fixture.spec.id)
    expect(tasks.find((t) => t.name === 'review-P1-r2')).toBeDefined()
    expect(fixture.ctx.taskRepo.get(fixTask.id)?.status).toBe('done')
    expect(fixture.ctx.runRepo.get(implRun.id)?.terminalState).toBe('failed')
  })
})

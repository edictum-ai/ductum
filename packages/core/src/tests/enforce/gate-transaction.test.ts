import type { RunCheckpointRepo } from '../../repos/interfaces.js'

import { createFixture, describe, expect, it, resolve } from './shared.js'

describe('EnforcementManager gate commit transaction', () => {
  it('advances the run stage and checkpoint together after a successful gate commit', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: process.cwd(),
    })

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve('README.md'),
    })

    expect(fixture.context.runRepo.get(fixture.run.id)?.stage).toBe('implement')
    expect(fixture.context.runCheckpointRepo.get(fixture.run.id)?.stage).toBe('implement')
    expect((await fixture.manager.getWorkflowState(fixture.run.id)).activeStage).toBe('implement')
  })

  it('rolls back workflow evidence, run stage, history, and checkpoint on a mid-commit failure', async () => {
    const fixture = createFixture('understand', {
      runCheckpointRepo: (context) => failingCheckpointRepo(context.runCheckpointRepo),
    })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: process.cwd(),
    })

    await expect(
      fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
        file_path: resolve('README.md'),
      }),
    ).rejects.toThrow('checkpoint write failed')

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('understand')
    expect(state.evidence.reads).not.toContain('README.md')
    expect(fixture.context.runRepo.get(fixture.run.id)?.stage).toBe('understand')
    expect(fixture.context.runStageHistoryRepo.list(fixture.run.id)).toEqual([])
    expect(fixture.context.runCheckpointRepo.get(fixture.run.id)).toBeNull()
  })
})

function failingCheckpointRepo(delegate: RunCheckpointRepo): RunCheckpointRepo {
  return {
    get: (runId) => delegate.get(runId),
    upsert: () => {
      throw new Error('checkpoint write failed')
    },
    list: (taskId) => delegate.list(taskId),
    getLatestStalledCheckpoint: (taskId) => delegate.getLatestStalledCheckpoint(taskId),
    listStalledCheckpoints: () => delegate.listStalledCheckpoints(),
    listHaltedResumableCheckpoints: () => delegate.listHaltedResumableCheckpoints(),
    delete: (runId) => delegate.delete(runId),
  }
}

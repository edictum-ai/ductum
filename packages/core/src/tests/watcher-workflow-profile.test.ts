import { afterEach, describe, expect, it } from 'vitest'

import { createId } from '../types.js'
import { CIWatcher } from '../watchers/ci-watcher.js'
import { childRunsFor, createCommandRunner, createWatcherFixture, flushWatchers } from './watcher-fixture.js'

const cleanup: Array<ReturnType<typeof createWatcherFixture>> = []

afterEach(() => {
  for (const fixture of cleanup.splice(0)) {
    fixture.context.db.close()
  }
})

describe('watcher workflow profile snapshots', () => {
  it('copies workflow profile snapshots into watcher child runs', async () => {
    const runtimeWorkflowProfile = {
      id: createId<'ConfigResourceId'>(),
      name: 'runtime-workflow',
      projectId: null,
      path: '/tmp/runtime-workflow.yaml',
      renderedWorkflow: 'apiVersion: edictum/v1alpha1\nkind: Workflow\nstages: []\n',
      setupCommands: [],
      verifyCommands: ['pnpm test'],
    }
    const fixture = createWatcherFixture('ship', { runtimeWorkflowProfile })
    cleanup.push(fixture)
    const runner = createCommandRunner({
      checks: [JSON.stringify([{ name: 'unit', state: 'completed', conclusion: 'success' }])],
    })
    const watcher = new CIWatcher(
      { type: 'ci', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter },
      { commandRunner: runner.runner },
    )

    watcher.start()
    await flushWatchers()

    expect(childRunsFor(fixture)[0]?.runtimeWorkflowProfile).toEqual(runtimeWorkflowProfile)
  })

  it('rejects path-only workflow profile snapshots before watcher child run creation', () => {
    const fixture = createWatcherFixture('ship', {
      runtimeWorkflowProfile: {
        id: createId<'ConfigResourceId'>(),
        name: 'path-only',
        projectId: null,
        path: '/tmp/path-only.yaml',
      },
    })
    cleanup.push(fixture)
    const runner = createCommandRunner({ checks: [] })
    const watcher = new CIWatcher(
      { type: 'ci', parentRunId: fixture.run.id, commitSha: fixture.run.commitSha!, pollIntervalMs: 1_000, timeoutMs: 5_000, prUrl: fixture.run.prUrl! },
      { runRepo: fixture.context.runRepo, evidenceRepo: fixture.context.evidenceRepo, stateMachine: fixture.stateMachine, eventEmitter: fixture.eventEmitter },
      { commandRunner: runner.runner },
    )

    expect(() => watcher.start()).toThrow('missing materialized renderedWorkflow')
    expect(childRunsFor(fixture)).toEqual([])
  })
})

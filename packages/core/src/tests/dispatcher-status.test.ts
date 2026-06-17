import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAGEvaluator } from '../dag.js'
import { Dispatcher, type HarnessAdapter } from '../dispatcher.js'
import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import type { DispatcherConfig } from '../dispatcher-support.js'
import { WatcherManager } from '../watcher-manager.js'
import { createRepoContext, type RepoContext } from './helpers.js'

const contexts: RepoContext[] = []

afterEach(() => {
  for (const context of contexts.splice(0)) context.db.close()
})

function createDispatcher(config: DispatcherConfig, adapters = new Map<string, HarnessAdapter>()) {
  const context = createRepoContext()
  contexts.push(context)
  const events = new DuctumEventEmitter()
  const dag = new DAGEvaluator(context.taskRepo, context.taskDependencyRepo, context.specRepo, context.specDependencyRepo, context.runRepo, events)
  const stateMachine = new RunStateMachine(context.runRepo, context.runStageHistoryRepo, events)
  const watcherManager = { stopWatchers: vi.fn(), spawnWatchers: vi.fn(), activeCount: vi.fn(() => 0) } as unknown as WatcherManager
  return new Dispatcher(
    dag,
    context.runRepo,
    context.taskRepo,
    context.agentRepo,
    context.projectAgentRepo,
    context.specRepo,
    context.projectRepo,
    stateMachine,
    watcherManager,
    context.sessionRunMappingRepo,
    adapters,
    events,
    config,
  )
}

describe('Dispatcher status', () => {
  it('reports no-dispatch startup mode as the disabled runtime reason', () => {
    const dispatcher = createDispatcher({
      enabled: false,
      disabledReason: 'dispatch disabled: server started without --dispatch',
    })

    expect(dispatcher.status()).toMatchObject({
      enabled: false,
      running: false,
      adapterCount: 0,
      reason: 'dispatch disabled: server started without --dispatch',
    })
  })

  it('keeps adapter-load failure distinct from no-dispatch startup mode', () => {
    const dispatcher = createDispatcher({
      enabled: false,
      disabledReason: 'dispatch disabled: harness adapters failed to load',
    })

    expect(dispatcher.status().reason).toBe('dispatch disabled: harness adapters failed to load')
  })

  it('preserves the legacy no-adapter reason when no explicit startup reason exists', () => {
    const dispatcher = createDispatcher({ enabled: false })

    expect(dispatcher.status().reason).toBe('dispatch disabled: no harness adapters loaded')
  })

  it('preserves enabled adapter status behavior', () => {
    const adapter = {} as HarnessAdapter
    const dispatcher = createDispatcher({ enabled: true }, new Map([['codex-sdk', adapter]]))

    expect(dispatcher.status()).toMatchObject({
      enabled: true,
      adapterCount: 1,
      adapters: ['codex-sdk'],
      reason: null,
    })
  })
})

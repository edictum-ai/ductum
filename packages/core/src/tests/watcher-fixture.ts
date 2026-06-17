import { vi } from 'vitest'

import { DuctumEventEmitter } from '../events.js'
import { RunStateMachine } from '../state-machine.js'
import { type Run, type RunWorkflowProfileSnapshot, type WorkflowStage } from '../types.js'
import type { WatcherCommandRunner } from '../watcher.js'
import { WatcherManager } from '../watcher-manager.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'

export function createWatcherFixture(
  stage: WorkflowStage = 'ship',
  options: { runtimeWorkflowProfile?: RunWorkflowProfileSnapshot } = {},
) {
  const context = createRepoContext()
  const ids = createIds()
  const { builder, project, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: 'P9-WATCHERS',
    prompt: 'implement P9',
    repos: ['packages/core'],
    assignedAgentId: builder.id,
    status: 'active',
    verification: ['pnpm test'],
  })
  const run = context.runRepo.create({
    id: ids.runId,
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage,
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: 'feat/p9-watchers',
    commitSha: 'abc123',
    prNumber: 42,
    prUrl: 'https://github.com/acartag7/ductum/pull/42',
    worktreePaths: null,
    runtimeWorkflowProfile: options.runtimeWorkflowProfile ?? null,
    ciStatus: stage === 'ship' ? null : 'pending',
    reviewStatus: stage === 'ship' ? null : 'pending',
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-04T10:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
  const events: string[] = []
  const eventEmitter = new DuctumEventEmitter()
  eventEmitter.subscribe((event) => {
    events.push(event.type)
  })
  const stateMachine = new RunStateMachine(
    context.runRepo,
    context.runStageHistoryRepo,
    eventEmitter,
  )
  return { context, eventEmitter, events, project, run, stateMachine }
}

export function createCommandRunner(outputs: {
  checks?: Array<string | Error>
  reviews?: Array<string | Error>
}) {
  const calls = { checks: 0, reviews: 0 }
  const runner: WatcherCommandRunner = vi.fn(async (args) => {
    const queue = args[1] === 'checks' ? outputs.checks : outputs.reviews
    if (queue == null || queue.length === 0) {
      throw new Error(`No mock output left for ${args[1]}`)
    }
    if (args[1] === 'checks') {
      calls.checks += 1
    } else {
      calls.reviews += 1
    }
    const next = queue.shift()!
    if (next instanceof Error) {
      throw next
    }
    return next
  })
  return { calls, runner }
}

export function createManager(
  fixture: ReturnType<typeof createWatcherFixture>,
  runner: WatcherCommandRunner,
  now: () => number = Date.now,
) {
  return new WatcherManager(
    fixture.context.runRepo,
    fixture.context.evidenceRepo,
    fixture.stateMachine,
    fixture.eventEmitter,
    {
      commandRunner: runner,
      now,
      ciPollIntervalMs: 1_000,
      ciTimeoutMs: 5_000,
      reviewPollIntervalMs: 1_000,
      reviewTimeoutMs: 5_000,
    },
  )
}

export async function flushWatchers() {
  await Promise.resolve()
  await Promise.resolve()
}

export function childRunsFor(fixture: ReturnType<typeof createWatcherFixture>): Run[] {
  return fixture.context.runRepo.list(fixture.run.taskId).filter((run) => run.parentRunId === fixture.run.id)
}

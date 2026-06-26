import { afterEach, describe, expect, it } from 'vitest'

import { createId } from '../types.js'
import { createRepoContext, seedBase } from './helpers.js'

let context: ReturnType<typeof createRepoContext> | undefined

afterEach(() => {
  context?.db.close()
  context = undefined
})

describe('run repo explicit unbounded listAll', () => {
  it('returns more than the default 50 runs when limit is null', () => {
    context = createRepoContext()
    const { builder, spec } = seedBase(context)

    for (let index = 0; index < 51; index += 1) {
      const task = context.taskRepo.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: `task-${index}`,
        prompt: `task ${index}`,
        repos: ['packages/core'],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      context.runRepo.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: `session-${index}`,
        branch: null,
        commitSha: null,
        prNumber: null,
        prUrl: null,
        worktreePaths: null,
        ciStatus: null,
        reviewStatus: null,
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: `2026-06-26T12:${String(index).padStart(2, '0')}:00.000Z`,
        heartbeatTimeoutSeconds: 120,
      })
    }

    expect(context.runRepo.listAll()).toHaveLength(50)
    expect(context.runRepo.listAll({ stage: 'implement' })).toHaveLength(50)
    expect(context.runRepo.listAll({ stage: 'implement', limit: null })).toHaveLength(51)
    expect(context.runRepo.listAll({ limit: null })).toHaveLength(51)
  })
})

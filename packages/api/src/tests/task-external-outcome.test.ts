import { createId } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase } from './helpers.js'

describe('record external task outcome', () => {
  it('attaches explicit external outcome evidence to an existing done run', async () => {
    const fixture = await createFixture()
    try {
      const { task, builder } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'done')
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'done',
        terminalState: null,
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: null,
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
        lastHeartbeat: '2026-05-01T12:00:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'done', reason: 'operator verified historical completion', author: 'operator' },
      })

      expect(response.response.status).toBe(201)
      expect(response.json).toMatchObject({
        run: { id: run.id },
        evidence: { payload: { kind: 'external-outcome', outcome: 'done' } },
      })
      const integrity = await requestJson(fixture.app, '/api/factory/execution-integrity')
      const taskEntry = (integrity.json as { tasks: Array<{ taskId: string; executionIssues: unknown[] }> })
        .tasks.find((item) => item.taskId === task.id)
      const runEntry = (integrity.json as { runs: Array<{ runId: string; executionIssues: unknown[] }> })
        .runs.find((item) => item.runId === run.id)
      expect(taskEntry?.executionIssues).toEqual([])
      expect(runEntry?.executionIssues).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('creates a synthetic done run when a completed task has no run history', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'done')

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'superseded', reason: 'superseded by later bakeoff proof', author: 'operator' },
      })

      expect(response.response.status).toBe(201)
      expect(response.json).toMatchObject({
        task: { id: task.id, status: 'done' },
        run: { taskId: task.id, stage: 'done', terminalState: null, sessionId: null, commitSha: null },
        evidence: { payload: { kind: 'external-outcome', outcome: 'superseded' } },
      })
      const integrity = await requestJson(fixture.app, '/api/factory/execution-integrity')
      const taskEntry = (integrity.json as { tasks: Array<{ taskId: string; executionIssues: unknown[] }> })
        .tasks.find((item) => item.taskId === task.id)
      expect(taskEntry?.executionIssues).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it('rejects recording an external outcome while the latest run is active', async () => {
    const fixture = await createFixture()
    try {
      const { task, builder } = seedBase(fixture)
      fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'implement',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand'],
        blockedReason: null,
        pendingApproval: false,
        sessionId: null,
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
        lastHeartbeat: '2026-05-01T12:00:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'done', reason: 'not while active' },
      })

      expect(response.response.status).toBe(409)
      expect(response.json).toMatchObject({ error: expect.stringContaining('has an active run') })
    } finally {
      fixture.close()
    }
  })

  it('reconciles a failed parent spec to done when the final task is completed externally', async () => {
    const fixture = await createFixture()
    try {
      const { spec, task, builder } = seedBase(fixture)
      const alreadyDoneTask = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        name: 'CLI',
        prompt: 'implement CLI',
        repos: ['packages/cli'],
        assignedAgentId: builder.id,
        status: 'done',
        verification: ['pnpm test'],
      })
      fixture.repos.tasks.updateStatus(task.id, 'failed')
      fixture.repos.specs.updateStatus(spec.id, 'failed')
      const evaluateTaskDAG = vi.spyOn(fixture.context.dag, 'evaluateTaskDAG')

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'fixed', reason: 'operator verified completion after external recovery' },
      })

      expect(response.response.status).toBe(201)
      expect(response.json).toMatchObject({
        alreadyRecorded: false,
        task: { id: task.id, status: 'done' },
      })
      expect(evaluateTaskDAG).toHaveBeenCalledWith(spec.id)
      expect(fixture.repos.tasks.get(alreadyDoneTask.id)?.status).toBe('done')
      expect(fixture.repos.specs.get(spec.id)?.status).toBe('done')
    } finally {
      fixture.close()
    }
  })

  it('is idempotent for duplicate matching external outcomes', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      const body = {
        outcome: 'done',
        reason: 'operator verified historical completion',
        author: 'operator',
      }

      const first = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body,
      })
      const second = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body,
      })

      expect(first.response.status).toBe(201)
      expect(second.response.status).toBe(200)
      expect(second.json).toMatchObject({ alreadyRecorded: true })
      expect(fixture.repos.runs.list(task.id)).toHaveLength(1)
      expect(
        fixture.repos.evidence.list((first.json as { run: { id: string } }).run.id as never)
          .filter((item) => item.type === 'custom' && item.payload.kind === 'external-outcome'),
      ).toHaveLength(1)
    } finally {
      fixture.close()
    }
  })

})

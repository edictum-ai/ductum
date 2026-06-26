import { createId } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase } from './helpers.js'

describe('record external task outcome anchor selection', () => {
  it('prefers the successful terminal run instead of a later cancelled child ghost', async () => {
    const fixture = await createFixture()
    try {
      const { task, builder } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'done')
      const root = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'done',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand', 'implement', 'ship'],
        blockedReason: null,
        pendingApproval: false,
        sessionId: null,
        branch: 'feat/task-fix',
        commitSha: 'abc123',
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        worktreePaths: null,
        ciStatus: 'pass',
        reviewStatus: 'pass',
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: '2026-05-01T12:00:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })
      fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: root.id,
        stage: 'done',
        terminalState: 'cancelled',
        resetCount: 0,
        completedStages: [],
        blockedReason: null,
        pendingApproval: false,
        sessionId: null,
        branch: root.branch,
        commitSha: root.commitSha,
        prNumber: root.prNumber,
        prUrl: root.prUrl,
        worktreePaths: null,
        ciStatus: null,
        reviewStatus: null,
        failReason: 'operator cancelled ghost child',
        recoverable: false,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: '2026-05-01T12:05:00.000Z',
        heartbeatTimeoutSeconds: 120,
      })

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'done', reason: 'operator verified final merged result' },
      })

      expect(response.response.status).toBe(201)
      expect(response.json).toMatchObject({ run: { id: root.id } })
    } finally {
      fixture.close()
    }
  })

  it('requires an explicit run anchor when multiple successful terminal runs exist', async () => {
    const fixture = await createFixture()
    try {
      const { task, builder } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'done')
      for (const suffix of ['a', 'b']) {
        fixture.repos.runs.create({
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
          branch: `feat/${suffix}`,
          commitSha: `abc12${suffix}`,
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
      }

      const response = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
        method: 'POST',
        body: { outcome: 'done', reason: 'ambiguous anchor should fail' },
      })

      expect(response.response.status).toBe(409)
      expect(response.text).toContain('multiple successful terminal runs')
    } finally {
      fixture.close()
    }
  })
})

import { createId } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase } from './helpers.js'

describe('operator brief GitHub lifecycle failures', () => {
  it('counts a failed ship attempt as needs-operator after lifecycle failure before approval', async () => {
    const fixture = await createFixture()
    try {
      const { task, builder } = seedBase(fixture)
      fixture.repos.tasks.updateStatus(task.id, 'active')
      fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: 'failed',
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
        failReason: 'GitHub issue lifecycle failed before approval: Repository edictum-ai/ductum is missing GitHub App installation auth. Production writes fail closed.',
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      const response = await requestJson(fixture.app, '/api/factory/operator-brief')
      expect(response.response.status).toBe(200)
      const brief = response.json as { queue: Record<string, number> }

      expect(brief.queue.needsOperator).toBe(1)
      expect(brief.queue.approvalsWaiting).toBe(0)
    } finally {
      fixture.close()
    }
  })
})

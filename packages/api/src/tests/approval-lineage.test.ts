import { afterEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('approval lineage safety', () => {
  let fixture: TestFixture | undefined

  afterEach(() => {
    fixture?.close()
    fixture = undefined
  })

  it('hides and rejects root approvals while descendant work is still open', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const baseRun = {
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      terminalState: null,
      resetCount: 0,
      completedStages: [],
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
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    }
    const root = fixture.repos.runs.create({
      ...baseRun,
      id: createId<'RunId'>(),
      stage: 'ship',
      blockedReason: 'waiting for approval',
      pendingApproval: true,
    })
    fixture.repos.runs.create({
      ...baseRun,
      id: createId<'RunId'>(),
      parentRunId: root.id,
      stage: 'implement',
      pendingApproval: false,
      blockedReason: null,
    })

    const list = await requestJson(fixture.app, '/api/runs?stage=ship')
    expect(list.response.status).toBe(200)
    expect(list.json).toEqual([])

    const approve = await requestJson(fixture.app, `/api/runs/${root.id}/approve`, {
      method: 'POST',
    })
    expect(approve.response.status).toBe(400)
    expect(approve.text).toContain('cannot be approved while descendant work is still active')
    expect(fixture.repos.runs.get(root.id)?.pendingApproval).toBe(true)
  })
})

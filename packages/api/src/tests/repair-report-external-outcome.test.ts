import { createId, type Run, type Task } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('repair report external outcome reconciliation', () => {
  it('suppresses linked commit lineage repair for cancelled bridge attempts when task outcome matches branch, commit, or PR source', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const cancelled = createRun(task, builder.id, {
      stage: 'ship',
      terminalState: 'cancelled',
      sessionId: null,
      worktreePaths: null,
      branch: 'bridge/p1-cancelled',
      commitSha: 'abc123',
      prUrl: 'https://github.com/edictum-ai/ductum/pull/99',
    })

    const outcome = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
      method: 'POST',
      body: {
        outcome: 'done',
        reason: 'operator verified bridged work on PR #99',
        branch: cancelled.branch,
        commitSha: cancelled.commitSha,
        sourcePath: cancelled.prUrl,
      },
    })
    expect(outcome.response.status).toBe(201)

    const repair = await requestJson(fixture.app, '/api/repair')
    expect(repair.response.status).toBe(200)
    const report = repair.json as { items: Array<{ id: string }> }
    expect(report.items.map((item) => item.id)).not.toContain(
      `attempt:${cancelled.id}:linked_commit_without_lineage`,
    )
  })

  it('keeps linked commit lineage repair when the task outcome does not match the cancelled attempt', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const cancelled = createRun(task, builder.id, {
      stage: 'ship',
      terminalState: 'cancelled',
      sessionId: null,
      worktreePaths: null,
      branch: 'bridge/p1-cancelled',
      commitSha: 'abc123',
      prUrl: 'https://github.com/edictum-ai/ductum/pull/99',
    })

    const outcome = await requestJson(fixture.app, `/api/tasks/${task.id}/external-outcome`, {
      method: 'POST',
      body: {
        outcome: 'done',
        reason: 'operator verified different branch',
        branch: 'bridge/other',
        commitSha: 'def456',
        sourcePath: 'https://github.com/edictum-ai/ductum/pull/100',
      },
    })
    expect(outcome.response.status).toBe(201)

    const repair = await requestJson(fixture.app, '/api/repair')
    expect(repair.response.status).toBe(200)
    const report = repair.json as {
      items: Array<{ id: string; suggestedAction: string }>
    }
    expect(report.items).toContainEqual(expect.objectContaining({
      id: `attempt:${cancelled.id}:linked_commit_without_lineage`,
      suggestedAction: expect.stringContaining(`ductum task outcome ${task.id} --outcome fixed`),
    }))
    const item = report.items.find((candidate) =>
      candidate.id === `attempt:${cancelled.id}:linked_commit_without_lineage`)
    expect(item?.suggestedAction).toContain("--branch 'bridge/p1-cancelled'")
    expect(item?.suggestedAction).toContain("--commit 'abc123'")
    expect(item?.suggestedAction).toContain("--source 'https://github.com/edictum-ai/ductum/pull/99'")
  })

  it('keeps linked commit lineage repair when no task-level external outcome exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const cancelled = createRun(task, builder.id, {
      stage: 'ship',
      terminalState: 'cancelled',
      sessionId: null,
      worktreePaths: null,
      branch: 'bridge/p1-cancelled',
      commitSha: 'abc123',
    })

    const repair = await requestJson(fixture.app, '/api/repair')
    expect(repair.response.status).toBe(200)
    const report = repair.json as {
      items: Array<{ id: string; suggestedAction: string }>
    }
    expect(report.items).toContainEqual(expect.objectContaining({
      id: `attempt:${cancelled.id}:linked_commit_without_lineage`,
      suggestedAction: expect.stringContaining(`ductum task outcome ${task.id} --outcome fixed`),
    }))
    const item = report.items.find((candidate) =>
      candidate.id === `attempt:${cancelled.id}:linked_commit_without_lineage`)
    expect(item?.suggestedAction).toContain("--branch 'bridge/p1-cancelled'")
    expect(item?.suggestedAction).toContain("--commit 'abc123'")
  })
})

function createRun(task: Task, agentId: Run['agentId'], overrides: Partial<Run> = {}): Run {
  if (fixture == null) throw new Error('test fixture missing')
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: 'feat/demo',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/worktree'],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}

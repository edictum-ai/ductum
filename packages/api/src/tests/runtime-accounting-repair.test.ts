import { afterEach, describe, expect, it } from 'vitest'
import { createId, type RepairHostChecks } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('runtime accounting repair', () => {
  it('surfaces runtime cost mismatches as repair items', async () => {
    fixture = await createFixture({
      getDispatcherStatus: dispatcherStatus,
      repairChecks: {
        git: ready('Git is installed'),
        factoryDataDir: ready('/tmp/ductum'),
        localApp: ready('API reachable on 4100'),
        providerAuth: {},
        repositories: {},
      } satisfies Partial<RepairHostChecks>,
    })
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'active')
    const run = fixture.repos.runs.create({
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
      sessionId: 'session-cost',
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/worktree'],
      ciStatus: null,
      reviewStatus: null,
      failReason: null,
      recoverable: true,
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 1.25,
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'attempt.runtime_accounting',
        schemaVersion: 1,
        mismatch: { kind: 'db_runtime_cost', runtimeReportedCostUsd: 2.5, storedCostUsd: 1.25 },
      },
    })

    const result = await requestJson(fixture.app, '/api/repair')
    const item = (result.json as { items: Array<{ issueCode?: string; title: string; reason: string }> }).items
      .find((candidate) => candidate.issueCode === 'runtime_cost_mismatch')

    expect(result.response.status).toBe(200)
    expect(item).toMatchObject({
      title: 'Runtime cost accounting mismatch',
      reason: expect.stringContaining('measured runtime cost'),
    })
  })
})

function dispatcherStatus() {
  return {
    running: true,
    activeRuns: 0,
    maxConcurrentRuns: 3,
    lastCycleAt: '2026-07-05T12:00:00.000Z',
    enabled: true,
    adapterCount: 2,
    adapters: ['claude-agent-sdk', 'codex-sdk'],
    reason: null,
  }
}

function ready(label: string) {
  return { state: 'ready' as const, label }
}

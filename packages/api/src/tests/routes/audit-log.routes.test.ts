import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type TestFixture } from './shared.js'
import { recordAuditEvent } from '../../lib/audit-log.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - audit log', () => {
  it('returns a global run-scoped audit log across durable sources without secret leakage', async () => {
    fixture = await createFixture()
    const { spec, task, builder } = seedBase(fixture)
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
      lastHeartbeat: '2026-07-01T00:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.runHistory.add({ runId: run.id, fromStage: 'understand', toStage: 'implement', reason: 'began work' })
    fixture.repos.runUpdates.create(run.id, 'operator retried run; task returned to ready queue')
    fixture.repos.decisions.create({
      id: createId<'DecisionId'>(),
      specId: spec.id,
      taskId: task.id,
      runId: run.id,
      decision: 'Approve retry',
      context: 'operator verified the worktree first',
      alternatives: null,
      decidedBy: 'alice',
      supersedesId: null,
    })
    fixture.repos.secretAccessLog.record({
      id: 'secret-access-1',
      secretId: 'github-app',
      runId: run.id,
      agentId: builder.id,
      outcome: 'failure',
      errorMessage: 'failed with sk-auditsecret123',
      attemptedAt: '2026-07-01T00:00:01.000Z',
    })

    const result = await requestJson(fixture.app, `/api/audit-log?runId=${run.id}&limit=20`)

    expect(result.response.status).toBe(200)
    const page = result.json as { items: Array<{ eventType: string; actor: string | null; status: string; metadata: unknown }> }
    expect(page.items.map((item) => item.eventType)).toEqual(expect.arrayContaining([
      'decision',
      'run.stage',
      'run.recovery',
      'secret.access',
    ]))
    expect(JSON.stringify(page)).not.toContain('sk-auditsecret123')
    expect(page.items.find((item) => item.eventType === 'secret.access')).toMatchObject({
      actor: builder.name,
      status: 'failure',
      metadata: { secretRef: 'secret:github-app' },
    })
  })

  it('filters by actor type status scope and time window', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
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
      lastHeartbeat: '2026-07-01T00:00:00.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.secretAccessLog.record({
      id: 'secret-access-2',
      secretId: 'github-app',
      runId: run.id,
      agentId: builder.id,
      outcome: 'success',
      errorMessage: null,
      attemptedAt: '2026-07-01T00:00:03.000Z',
    })

    const result = await requestJson(
      fixture.app,
      `/api/audit-log?actor=${builder.name}&eventType=secret.access&status=success&runId=${run.id}&from=2026-07-01T00:00:02.000Z&to=2026-07-01T00:00:04.000Z`,
    )

    expect(result.response.status).toBe(200)
    expect((result.json as { items: unknown[] }).items).toHaveLength(1)
  })

  it('records settings changes as audit events', async () => {
    fixture = await createFixture()
    seedBase(fixture)

    const write = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      body: { dispatcherEnabled: false },
    })
    expect(write.response.status).toBe(200)

    const result = await requestJson(fixture.app, '/api/audit-log?eventType=settings.runtime.updated')
    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      items: [
        expect.objectContaining({
          actor: 'unknown-operator',
          eventType: 'settings.runtime.updated',
          title: 'Factory runtime settings updated',
          metadata: expect.objectContaining({ changedFields: ['dispatcherEnabled'] }),
        }),
      ],
    })
  })

  it('rolls back runtime settings writes when the audit row cannot be recorded', async () => {
    fixture = await createFixture()
    const { factory } = seedBase(fixture)
    fixture.db.exec('DROP TABLE audit_events')

    const write = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      body: { dispatcherEnabled: false },
    })

    expect(write.response.status).toBe(500)
    expect(fixture.repos.runtimeSettings.get(factory.id)).toBeNull()
  })

  it('rolls back secret metadata deletes when the audit row cannot be recorded', async () => {
    fixture = await createFixture()
    seedBase(fixture)
    const secret = fixture.repos.secrets.create({
      id: 'audit-delete-secret',
      name: 'audit-delete-secret',
      scope: 'factory',
      projectId: null,
      description: null,
      status: 'configured',
      keySource: { type: 'local-file', keyId: 'local:test' },
      payload: {
        algorithm: 'aes-256-gcm',
        ciphertext: 'ciphertext',
        nonce: 'nonce',
        authTag: 'auth-tag',
      },
      lastRotatedAt: null,
      lastTestedAt: null,
    })
    fixture.db.exec('DROP TABLE audit_events')

    const deleted = await requestJson(fixture.app, `/api/factory/secrets/${secret.id}`, { method: 'DELETE' })

    expect(deleted.response.status).toBe(500)
    expect(fixture.repos.secrets.get(secret.id)).not.toBeNull()
  })

  it('paginates with stable cursors without overlap', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    for (const [index, millis] of [[1, '100'], [2, '500'], [3, '900']] as const) {
      recordAuditEvent(fixture.context, {
        projectId: project.id,
        eventType: 'settings.factory.updated',
        status: 'applied',
        title: `settings ${index}`,
        occurredAt: `2026-07-01T00:00:01.${millis}Z`,
      })
    }

    const first = await requestJson(fixture.app, '/api/audit-log?eventType=settings.factory.updated&limit=2')
    expect(first.response.status).toBe(200)
    const firstPage = first.json as { items: Array<{ id: string; title: string }>; nextCursor: string | null }
    expect(firstPage.items.map((item) => item.title)).toEqual(['settings 3', 'settings 2'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const second = await requestJson(fixture.app, `/api/audit-log?eventType=settings.factory.updated&limit=2&cursor=${firstPage.nextCursor}`)
    expect(second.response.status).toBe(200)
    const secondPage = second.json as { items: Array<{ id: string; title: string }>; nextCursor: string | null }
    expect(secondPage.items.map((item) => item.title)).toEqual(['settings 1'])
    expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(3)
  })
})

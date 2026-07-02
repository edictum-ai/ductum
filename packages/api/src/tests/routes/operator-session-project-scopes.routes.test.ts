import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type TestFixture,
} from './shared.js'
import type { OperatorSessionScope, ProjectId, Run } from '@ductum/core'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API operator session project scopes', () => {
  it('blocks project-scoped browser sessions from crossing project boundaries', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    const { factory, project, task, builder } = seedBase(fixture)
    const run = approvalRun(fixture, task.id, builder.id)
    const other = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'other',
      repos: [],
      config: { mergeMode: 'human', workflowPath: 'workflows/coding-guard.yaml' },
    })
    const cookie = scopedCookie(fixture, ['read'], 'project-auditor', [project.id])

    const allowed = await requestJson(fixture.app, `/api/projects/${project.id}`, { headers: { cookie } })
    expect(allowed.response.status).toBe(200)

    const denied = await requestJson(fixture.app, `/api/projects/${other.id}`, { headers: { cookie } })
    expect(denied.response.status).toBe(403)
    expect(denied.json).toMatchObject({ error: 'Operator session is not scoped to this project' })

    const current = await requestJson(fixture.app, '/api/operator/session', { headers: { cookie } })
    expect(current.response.status).toBe(200)
    for (const path of ['/api/operator/sessions', '/api/projects', '/api/runs', '/api/attempts', '/api/search?q=ductum']) {
      const aggregate = await requestJson(fixture.app, path, { headers: { cookie } })
      expect(aggregate.response.status).toBe(403)
    }

    const resolveProject = await requestJson(fixture.app, '/api/resolve/ductum', { headers: { cookie } })
    expect(resolveProject.response.status).toBe(200)

    const resolveRun = await requestJson(fixture.app, `/api/resolve/runs/${run.id}`, { headers: { cookie } })
    expect(resolveRun.response.status).toBe(200)

    const resolveOther = await requestJson(fixture.app, '/api/resolve/other', { headers: { cookie } })
    expect(resolveOther.response.status).toBe(403)

    const dispatchOtherProject = await requestJson(fixture.app, '/api/runs/dispatch', {
      method: 'POST',
      headers: { cookie },
      body: { taskId: 'unknown-task', agentId: 'unknown-agent' },
    })
    expect(dispatchOtherProject.response.status).toBe(403)
  })

  it('allows project-scoped sessions to read same-project secret metadata only', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    const { factory, project } = seedBase(fixture)
    const other = fixture.repos.projects.create({
      id: createId<'ProjectId'>(),
      factoryId: factory.id,
      name: 'other',
      repos: [],
      config: { mergeMode: 'human', workflowPath: 'workflows/coding-guard.yaml' },
    })
    seedSecret(fixture, 'project-secret', project.id)
    seedSecret(fixture, 'other-secret', other.id)
    seedSecret(fixture, 'factory-secret', null)
    const cookie = scopedCookie(fixture, ['read'], 'project-auditor', [project.id])

    const listed = await requestJson(fixture.app, `/api/factory/secrets?projectId=${project.id}`, { headers: { cookie } })
    expect(listed.response.status).toBe(200)
    expect(listed.json).toHaveLength(1)

    const sameProject = await requestJson(fixture.app, '/api/factory/secrets/project-secret', { headers: { cookie } })
    expect(sameProject.response.status).toBe(200)

    const history = await requestJson(fixture.app, '/api/factory/secrets/project-secret/access-history', { headers: { cookie } })
    expect(history.response.status).toBe(200)

    const otherProject = await requestJson(fixture.app, '/api/factory/secrets/other-secret', { headers: { cookie } })
    expect(otherProject.response.status).toBe(403)

    const factorySecret = await requestJson(fixture.app, '/api/factory/secrets/factory-secret', { headers: { cookie } })
    expect(factorySecret.response.status).toBe(403)
  })

  it('invalidates browser sessions after expiry or operator token rotation', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const nowMs = Date.parse('2026-07-02T00:00:00.000Z')
    const minted = fixture.context.operatorSessions.mint({
      operatorToken: 'operator-secret',
      nowMs,
      actor: 'auditor',
      scopes: ['read'],
    })

    expect(fixture.context.operatorSessions.authenticate({
      sessionId: minted.sessionId,
      operatorToken: 'operator-secret',
      nowMs,
    })?.actor).toBe(minted.session.actor)
    expect(fixture.context.operatorSessions.authenticate({
      sessionId: minted.sessionId,
      operatorToken: 'rotated-secret',
      nowMs,
    })).toBeNull()
    expect(fixture.context.operatorSessions.authenticate({
      sessionId: minted.sessionId,
      operatorToken: 'operator-secret',
      nowMs: nowMs + 12 * 60 * 60 * 1000 + 1,
    })).toBeNull()
  })
})

function scopedCookie(
  current: TestFixture,
  scopes: OperatorSessionScope[],
  actor: string,
  projectIds: ProjectId[] | null = null,
): string {
  const minted = current.context.operatorSessions.mint({
    operatorToken: 'operator-secret',
    nowMs: Date.now(),
    actor,
    scopes,
    projectIds,
  })
  return `ductum_operator_token=${encodeURIComponent(minted.sessionId)}`
}

function approvalRun(current: TestFixture, taskId: string, agentId: string): Run {
  return current.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: taskId as never,
    agentId: agentId as never,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: true,
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
  })
}

function seedSecret(current: TestFixture, id: string, projectId: ProjectId | null): void {
  current.repos.secrets.create({
    id,
    name: id,
    scope: projectId == null ? 'factory' : 'project',
    projectId,
    description: null,
    status: 'configured',
    keySource: { type: 'local-file', keyId: 'local-key' },
    payload: { algorithm: 'aes-256-gcm', ciphertext: 'ciphertext', nonce: 'nonce', authTag: 'tag' },
    lastRotatedAt: null,
    lastTestedAt: null,
  })
}

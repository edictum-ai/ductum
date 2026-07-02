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

describe('API operator session scopes', () => {
  it('blocks read-only browser sessions from mutating settings', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const cookie = scopedCookie(fixture, ['read'], 'auditor')

    const read = await requestJson(fixture.app, '/api/factory', { headers: { cookie } })
    expect(read.response.status).toBe(200)

    const write = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      headers: { cookie },
      body: { heartbeatTimeoutSeconds: 121 },
    })
    expect(write.response.status).toBe(403)
    expect(write.json).toMatchObject({ error: 'Operator session scope required', requiredScope: 'operator' })
  })

  it('allows approver sessions to reject approvals but not change settings or secrets', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    const { task, builder } = seedBase(fixture)
    const run = approvalRun(fixture, task.id, builder.id)
    const cookie = scopedCookie(fixture, ['approver'], 'reviewer')

    const settings = await requestJson(fixture.app, '/api/factory/settings', {
      method: 'PATCH',
      headers: { cookie },
      body: { heartbeatTimeoutSeconds: 130 },
    })
    expect(settings.response.status).toBe(403)

    const secret = await requestJson(fixture.app, '/api/factory/secrets', {
      method: 'POST',
      headers: { cookie },
      body: { name: 'API_KEY', value: 'secret' },
    })
    expect(secret.response.status).toBe(403)

    const reject = await requestJson(fixture.app, `/api/runs/${run.id}/reject`, {
      method: 'POST',
      headers: { cookie },
      body: { reason: 'scope proof' },
    })
    expect(reject.response.status).toBe(200)
    expect(fixture.repos.runs.get(run.id)?.pendingApproval).toBe(false)
  })

  it('lists and revokes persisted browser sessions by public id only', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const minted = fixture.context.operatorSessions.mint({
      operatorToken: 'operator-secret',
      nowMs: Date.now(),
      actor: 'auditor',
      scopes: ['read'],
    })

    const listed = await requestJson(fixture.app, '/api/operator/sessions', {
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })
    expect(listed.response.status).toBe(200)
    const [session] = (listed.json as { sessions: Array<{ id: string; actor: string }> }).sessions
    expect(session?.actor).toMatch(/^auditor#[A-Za-z0-9_-]{8}$/)
    expect(session?.id).not.toBe(minted.sessionId)

    const revoked = await requestJson(fixture.app, `/api/operator/sessions/${session!.id}`, {
      method: 'DELETE',
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })
    expect(revoked.response.status).toBe(200)

    const afterRevoke = await requestJson(fixture.app, '/api/factory', {
      headers: { cookie: cookiePair(minted.sessionId) },
    })
    expect(afterRevoke.response.status).toBe(401)
  })

  it('creates a scoped current-browser session without echoing the cookie secret', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)

    const created = await requestJson(fixture.app, '/api/operator/sessions', {
      method: 'POST',
      headers: { 'x-ductum-operator-token': 'operator-secret' },
      body: { actor: 'approver-one', scopes: ['approver'] },
    })

    expect(created.response.status).toBe(201)
    const cookie = created.response.headers.get('set-cookie') ?? ''
    const cookieValue = cookiePairFromSetCookie(cookie)
    expect(cookieValue).toContain('ductum_operator_token=dos_')
    expect(created.text).not.toContain(cookieValue.replace('ductum_operator_token=', ''))
    const createdSession = (created.json as { session: { actor: string } }).session
    expect(createdSession.actor).toMatch(/^approver-one#[A-Za-z0-9_-]{8}$/)
    expect(created.json).toMatchObject({
      session: { scopes: ['approver'] },
      current: true,
    })

    const current = await requestJson(fixture.app, '/api/operator/session', {
      headers: { cookie: cookieValue },
    })
    expect(current.response.status).toBe(200)
    expect(current.json).toMatchObject({ actor: createdSession.actor, scopes: ['approver'] })
  })

  it('does not let a browser session spoof a new audit actor', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const root = fixture.context.operatorSessions.mint({
      operatorToken: 'operator-secret',
      nowMs: Date.now(),
      actor: 'session-admin',
      scopes: ['operator'],
    })

    const created = await requestJson(fixture.app, '/api/operator/sessions', {
      method: 'POST',
      headers: { cookie: cookiePair(root.sessionId) },
      body: { actor: 'spoofed-alice', scopes: ['operator'] },
    })

    expect(created.response.status).toBe(201)
    expect(created.text).not.toContain('spoofed-alice')
    const actor = (created.json as { session: { actor: string } }).session.actor
    expect(actor).toMatch(/^session-admin#[A-Za-z0-9_-]{8}#[A-Za-z0-9_-]{8}$/)
  })

  it('blocks read-only all-factory sessions from listing operator sessions', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const cookie = scopedCookie(fixture, ['read'], 'auditor')

    const listed = await requestJson(fixture.app, '/api/operator/sessions', {
      headers: { cookie },
    })

    expect(listed.response.status).toBe(403)
    expect(listed.json).toMatchObject({ error: 'Operator session scope required', requiredScope: 'operator' })
  })

  it('records settings writes with the browser session actor', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const cookie = scopedCookie(fixture, ['operator'], 'session-admin')

    const write = await requestJson(fixture.app, '/api/factory/runtime', {
      method: 'PATCH',
      headers: { cookie },
      body: { dispatcherEnabled: false },
    })
    expect(write.response.status).toBe(200)

    const audit = await requestJson(fixture.app, '/api/audit-log?eventType=settings.runtime.updated', {
      headers: { cookie },
    })
    expect(audit.response.status).toBe(200)
    expect(audit.json).toMatchObject({
      items: [expect.objectContaining({ actor: expect.stringMatching(/^session-admin#[A-Za-z0-9_-]{8}$/) })],
    })
  })

  it('ignores caller-supplied decidedBy on browser-session run decisions', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret', costBudget: { perRunHardUsd: 5 } })
    const { task, builder } = seedBase(fixture)
    const run = approvalRun(fixture, task.id, builder.id)
    fixture.repos.runs.updateTokens(run.id, 0, 0, 6)
    fixture.repos.runs.updateFailure(run.id, 'cost_budget_paused: proof', true)
    fixture.repos.runs.updateTerminalState(run.id, 'stalled')
    const cookie = scopedCookie(fixture, ['operator'], 'session-admin')

    const decision = await requestJson(fixture.app, `/api/runs/${run.id}/decide`, {
      method: 'POST',
      headers: { cookie },
      body: { decision: 'continue', context: 'proof', decidedBy: 'spoofed-user' },
    })
    expect(decision.response.status).toBe(201)
    const actor = (decision.json as { decidedBy: string }).decidedBy
    expect(actor).toMatch(/^session-admin#[A-Za-z0-9_-]{8}$/)

    const budget = await requestJson(fixture.app, `/api/runs/${run.id}/budget-deny`, {
      method: 'POST',
      headers: { cookie },
      body: { reason: 'no', decidedBy: 'spoofed-user' },
    })
    expect(budget.response.status).toBe(200)
    const evidence = fixture.repos.evidence.list(run.id)
    expect(evidence.some((item) => {
      const payload = item.payload as Record<string, unknown>
      return payload.operation === 'budget.deny' && payload.decided_by === actor
    })).toBe(true)
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
  return cookiePair(minted.sessionId)
}

function cookiePair(sessionId: string): string {
  return `ductum_operator_token=${encodeURIComponent(sessionId)}`
}

function cookiePairFromSetCookie(setCookie: string): string {
  return setCookie.split(';')[0] ?? ''
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

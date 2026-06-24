import { createFixture, createId, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, type Run, type TestFixture } from './shared.js'
import { buildRuntimeReviewEvidencePayload, buildRuntimeVerificationEvidencePayload } from '../../lib/runtime-approval-evidence.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - unattended approval guards', () => {
  it('rejects tokenless unattended approval when the API started without an operator token', async () => {
    fixture = await createFixture({ operatorToken: '' })
    const { task, builder } = seedBase(fixture)
    const run = makeRun(task.id, builder.id)
    fixture.repos.runs.create(run)
    addPassingEvidence(run.id)
    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST', body: { unattended: true } })
    expect(result.response.status).toBe(403)
    expect(result.json).toMatchObject({ error: expect.stringContaining('Configure DUCTUM_OPERATOR_TOKEN') })
  })

  it('rejects unattended approval without a valid operator token even when one is configured', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret', costBudget: { perRunHardUsd: 10 } })
    const { task, builder } = seedBase(fixture)
    const run = makeRun(task.id, builder.id)
    fixture.repos.runs.create(run)
    addPassingEvidence(run.id)
    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, { method: 'POST', body: { unattended: true } })
    expect(result.response.status).toBe(401)
    expect(result.json).toMatchObject({ error: 'Operator token required' })
  })

  it('fails closed when perRunHardUsd is missing and tells the operator how to recover', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    const { task, builder } = seedBase(fixture)
    const run = makeRun(task.id, builder.id)
    fixture.repos.runs.create(run)
    addPassingEvidence(run.id)
    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
      method: 'POST',
      body: { unattended: true },
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })
    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      reason: expect.stringContaining('perRunHardUsd is not configured'),
      followupCommand: expect.stringContaining('budgets.perRunHardUsd'),
    })
  })

  it('blocks unattended approval when no worktree clean state is recorded', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret', costBudget: { perRunHardUsd: 10 } })
    const { task, builder } = seedBase(fixture)
    const run = makeRun(task.id, builder.id)
    fixture.repos.runs.create(run)
    addPassingEvidence(run.id)
    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
      method: 'POST',
      body: { unattended: true },
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })
    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({ success: false, reason: expect.stringContaining('git clean state is unknown') })
  })
})

function addPassingEvidence(runId: Run['id'], commitSha = 'abc123') {
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: buildRuntimeVerificationEvidencePayload({ commitSha } as Pick<Run, 'commitSha'>, { passed: true, output: 'ok' }),
  })
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: buildRuntimeReviewEvidencePayload({ verdict: 'pass', passed: true, feedback: 'PASS' }, commitSha),
  })
}

function makeRun(taskId: Run['taskId'], agentId: Run['agentId']): Run {
  return {
    id: createId<'RunId'>(), taskId, agentId, parentRunId: null, stage: 'ship', terminalState: null,
    resetCount: 0, completedStages: ['understand', 'implement'], blockedReason: null, pendingApproval: true,
    sessionId: null, branch: 'feature/x', commitSha: 'abc123', prNumber: null, prUrl: null, worktreePaths: null,
    runtimeModel: null, runtimeHarness: null, runtimeSandboxProfile: null, runtimeWorkflowProfile: {
      id: createId<'ConfigResourceId'>(), name: 'guard', projectId: null, path: 'workflow.yaml',
      unattended: { autoApprove: true, autoMerge: true, autoPush: false, pushRequires: 'local_verify' },
    },
    ciStatus: null, reviewStatus: null, failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
    lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0, completionSummary: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
}

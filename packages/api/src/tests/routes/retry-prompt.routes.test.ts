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

let fixture: TestFixture | undefined

registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - retry prompt injection (#243)', () => {
  it('POST /api/runs/:id/retry injects the operator reason into the implementation prompt', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
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
      failReason: 'tests failed',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, {
      method: 'POST',
      body: { reason: 'the test fixture caused a false negative' },
    })

    expect(result.response.status).toBe(200)
    const prompt = fixture.repos.tasks.get(task.id)?.prompt ?? ''
    expect(prompt).toContain('## Operator Retry Context')
    expect(prompt).toContain('Reason: the test fixture caused a false negative')
    expect(prompt).toContain('Address the operator-reported issue above')
    // The original task prompt is still present above the marker.
    expect(prompt.indexOf('implement P4')).toBeLessThan(prompt.indexOf('## Operator Retry Context'))
  })

  it('POST /api/runs/:id/retry replaces the prior retry context instead of stacking stale blocks', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updatePrompt(task.id, [
      task.prompt,
      '',
      '## Operator Retry Context',
      'Reason: first attempt reason that should be replaced',
      '',
      'Address the operator-reported issue above. Do not repeat work that the operator already rejected.',
    ].join('\n'))
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
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
      failReason: 'second failure observation',
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, {
      method: 'POST',
      body: { reason: 'second attempt reason that must replace the stale block' },
    })

    expect(result.response.status).toBe(200)
    const prompt = fixture.repos.tasks.get(task.id)?.prompt ?? ''
    expect(prompt.match(/## Operator Retry Context/g) ?? []).toHaveLength(1)
    expect(prompt).not.toContain('first attempt reason that should be replaced')
    expect(prompt).toContain('Reason: second attempt reason that must replace the stale block')
    // The original implementation prompt is preserved exactly once.
    expect(prompt.match(/implement P4/g) ?? []).toHaveLength(1)
  })

  it('POST /api/runs/:id/retry keeps the original implementation prompt when no operator reason is supplied', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
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
      failReason: null,
      recoverable: true,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(200)
    const prompt = fixture.repos.tasks.get(task.id)?.prompt ?? ''
    // Without a reason we don't add an operator retry block.
    expect(prompt).not.toContain('## Operator Retry Context')
    expect(prompt).toContain('implement P4')
  })
})

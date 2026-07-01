import {
  createFixture,
  createId,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

it('keeps active review runs visible as running even when a fix task is open', async () => {
  fixture = await createFixture()
  const { task, builder, reviewer, spec } = seedBase(fixture)
  const fixTask = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: `fix-${task.name}-r1`,
    prompt: 'fix review findings',
    repos: task.repos,
    assignedAgentId: builder.id,
    requiredRole: 'builder',
    status: 'active',
    verification: [],
  })
  const reviewTask = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: `review-${task.name}-r2`,
    prompt: 'review fix',
    repos: task.repos,
    assignedAgentId: reviewer.id,
    requiredRole: 'reviewer',
    status: 'active',
    verification: [],
  })
  const fixRun = fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: fixTask.id,
    agentId: builder.id,
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'fix-session',
    branch: 'ductum/rest-api',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/ductum-rest-api'],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)
  const reviewRun = fixture.repos.runs.create({
    ...fixRun,
    id: createId<'RunId'>(),
    taskId: reviewTask.id,
    agentId: reviewer.id,
    parentRunId: fixRun.id,
    sessionId: 'review-session',
    branch: null,
    commitSha: null,
  } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'verifyRetries'>)

  const { json } = await requestJson(fixture.app, `/api/runs/${reviewRun.id}`)

  expect((json as { ui?: { status?: { key?: string; label?: string } } }).ui?.status).toMatchObject({
    key: 'running',
    label: 'Running',
  })
})

it('keeps project-scoped implementation runs in awaiting review while follow-up review is open', async () => {
  fixture = await createFixture()
  const { task, builder, reviewer, spec, project } = seedBase(fixture)
  fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    name: `review-${task.name}-r1`,
    prompt: 'review implementation',
    repos: task.repos,
    assignedAgentId: reviewer.id,
    requiredRole: 'reviewer',
    status: 'active',
    verification: [],
  })
  const run = fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement', 'verify', 'done'],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'impl-session',
    branch: 'ductum/rest-api',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: ['/tmp/ductum-rest-api'],
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
  } satisfies Omit<Run, 'createdAt' | 'updatedAt' | 'completionSummary' | 'runtimeModel' | 'runtimeHarness' | 'runtimeSandboxProfile' | 'runtimeWorkflowProfile' | 'verifyRetries'>)

  const { json } = await requestJson(fixture.app, `/api/projects/${project.id}/runs`)
  const projectRun = (json as Array<{ id: string; ui?: { status?: { key?: string; label?: string } } }>)
    .find((item) => item.id === run.id)

  expect(projectRun?.ui?.status).toMatchObject({
    key: 'awaiting_review',
    label: 'Awaiting review',
  })
})

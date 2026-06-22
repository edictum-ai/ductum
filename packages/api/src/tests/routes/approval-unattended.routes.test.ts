import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupMergeFixture,
  execFileAsync,
  writeFile,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - unattended approvals', () => {
  it('does not bypass manual approval when workflow policy is absent', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree)
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        stage: 'ship',
        reason: expect.stringContaining('workflow does not define unattended approval policy'),
      })
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'ship', pendingApproval: true })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks unattended push when workflow policy requires unknown remote CI', async () => {
    fixture = await createFixture({ merge: { push: true, base: 'main', strategy: 'merge' } })
    const { task, builder } = seedBase(fixture)
    const run = makeRun(task.id, builder.id, null, {
      runtimeWorkflowProfile: policy({ autoPush: true, pushRequires: 'remote_ci' }),
      ciStatus: null,
    })
    fixture.repos.runs.create(run)
    addPassingEvidence(run.id)

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
      method: 'POST',
      body: { unattended: true },
    })

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      success: false,
      reason: expect.stringContaining('remote CI is not green'),
    })
    expect(fixture.repos.gateEvaluations.list(run.id).at(-1)).toMatchObject({
      target: 'approval.unattended',
      result: 'blocked',
    })
  })

  it('allows unattended local merge with explicit workflow policy and passing gates', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree, {
        runtimeWorkflowProfile: policy(),
      })
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done', pushed: false })
      expect(fixture.repos.runs.get(run.id)).toMatchObject({ stage: 'done', pendingApproval: false })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('stops unattended push loudly when remote auth or origin is missing', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture({ merge: { push: true, base: 'main', strategy: 'merge' } })
      const { task, builder } = seedBase(fixture)
      const { stdout: baseBefore } = await execFileAsync(
        'git',
        ['-C', mergeFix.upstream, 'rev-parse', 'main'],
        { encoding: 'utf-8' },
      )
      const run = makeRun(task.id, builder.id, mergeFix.worktree, {
        runtimeWorkflowProfile: policy({ autoPush: true }),
      })
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id)

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        stage: 'ship',
        reason: expect.stringContaining('push of main to origin failed'),
      })
      expect(fixture.repos.runs.get(run.id)?.failReason).toMatch(/merge failed: push of main/)
      const { stdout: baseAfter } = await execFileAsync(
        'git',
        ['-C', mergeFix.upstream, 'rev-parse', 'main'],
        { encoding: 'utf-8' },
      )
      expect(baseAfter.trim()).toBe(baseBefore.trim())
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)

  it('blocks unattended approval when the worktree is dirty', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)
      const run = makeRun(task.id, builder.id, mergeFix.worktree, {
        runtimeWorkflowProfile: policy(),
      })
      fixture.repos.runs.create(run)
      addPassingEvidence(run.id)
      await writeFile(`${mergeFix.worktree}/dirty.txt`, 'uncommitted\n')

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve`, {
        method: 'POST',
        body: { unattended: true },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({
        success: false,
        reason: expect.stringContaining('git worktree has uncommitted changes'),
      })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

function addPassingEvidence(runId: Run['id']) {
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: { kind: 'verify', passed: true, output: 'ok', commitSha: 'abc123' },
  })
  fixture!.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: { kind: 'internal-review', verdict: 'pass', passed: true, commitSha: 'abc123' },
  })
}

function policy(overrides: Partial<NonNullable<Run['runtimeWorkflowProfile']>['unattended']> = {}) {
  return {
    id: createId<'ConfigResourceId'>(),
    name: 'guard',
    projectId: null,
    path: 'workflow.yaml',
    unattended: {
      autoApprove: true,
      autoMerge: true,
      autoPush: false,
      pushRequires: 'local_verify' as const,
      ...overrides,
    },
  }
}

function makeRun(
  taskId: Run['taskId'],
  agentId: Run['agentId'],
  worktreePath: string | null,
  overrides: Partial<Run> = {},
): Run {
  return {
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feature/x',
    commitSha: 'abc123',
    prNumber: null,
    prUrl: null,
    worktreePaths: worktreePath == null ? null : [worktreePath],
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

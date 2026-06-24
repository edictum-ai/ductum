import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - cost budget', () => {
  it('enforceCostBudget kills + freezes the run once perRunHardUsd is crossed', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.context.costBudget = { perRunWarnUsd: 1, perRunHardUsd: 5 }
    const killed: string[] = []
    fixture.context.killRun = async (runId) => { killed.push(runId) }

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
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    // Below warn — no kill, no terminal state.
    fixture.repos.runs.updateTokens(run.id, 0, 0, 0.5)
    let killedNow = await enforceCostBudget(fixture.context, run.id)
    expect(killedNow).toBe(false)
    expect(killed).toHaveLength(0)
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()

    // Crosses warn — still alive but warned.
    fixture.repos.runs.updateTokens(run.id, 0, 0, 0.6)
    killedNow = await enforceCostBudget(fixture.context, run.id)
    expect(killedNow).toBe(false)
    expect(fixture.context.costBudgetWarned.has(run.id)).toBe(true)

    // Crosses hard cap — kill + freeze.
    fixture.repos.runs.updateTokens(run.id, 0, 0, 4.5)
    killedNow = await enforceCostBudget(fixture.context, run.id)
    expect(killedNow).toBe(true)
    expect(killed).toEqual([run.id])
    const after = fixture.repos.runs.get(run.id)
    expect(after?.terminalState).toBe('frozen')
    expect(after?.failReason).toMatch(/cost_budget_paused/)
  })

  it('precheckCostBudget kills BEFORE the write lands on a single overshoot batch', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.context.costBudget = { perRunHardUsd: 5 }
    const killed: string[] = []
    fixture.context.killRun = async (runId) => { killed.push(runId) }

    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 4.99,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
    })

    // Project a huge single-batch overshoot (e.g. one Codex turn that
    // ingested half a million tokens). The run is at $4.99 and the
    // batch would push it to $30 — well past the $5 hard cap.
    const wouldKill = await precheckCostBudget(fixture.context, run.id, 30)
    expect(wouldKill).toBe(true)
    expect(killed).toEqual([run.id])
    const after = fixture.repos.runs.get(run.id)
    expect(after?.terminalState).toBe('frozen')
    expect(after?.failReason).toMatch(/cost_budget_paused/)
    // Crucially: the run's cost is still the pre-batch value, not the
    // overshoot value. The "before write" guarantee.
    expect(after?.costUsd).toBe(4.99)
  })

  it('precheckCostBudget allows writes that stay under the cap', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.context.costBudget = { perRunHardUsd: 10 }
    fixture.context.killRun = async () => undefined

    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 3,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
    })

    const wouldKill = await precheckCostBudget(fixture.context, run.id, 9.5)
    expect(wouldKill).toBe(false)
    expect(fixture.repos.runs.get(run.id)?.terminalState).toBeNull()
  })

  it('POST /api/runs/:id/tokens prices Codex app-server usage from runtimeModel, not the stored agent default', async () => {
    fixture = await createFixture()
    const { task } = seedBase(fixture)
    const agent = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'runtime-codex',
      model: 'llama-42-enormous',
      harness: 'codex-app-server',
      capabilities: ['build'],
      costTier: 10,
      spawnConfig: {},
    })

    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: agent.id, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, runtimeModel: 'openai/gpt-5.4', runtimeHarness: 'codex-app-server',
      runtimeSandboxProfile: null, runtimeWorkflowProfile: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/tokens`, {
      method: 'POST',
      body: { tokensIn: 500_000, tokensOut: 250_000, model: 'gpt-5.4' },
    })

    expect(result.response.status).toBe(200)
    expect(fixture.repos.runs.get(run.id)?.costUsd).toBeCloseTo(5, 6)
  })

  it('does not treat unpriced Codex usage as free when a budget gate is active', async () => {
    fixture = await createFixture({ costBudget: { perRunHardUsd: 1 } })
    const { task } = seedBase(fixture)
    fixture.context.killRun = async () => undefined
    const agent = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'unpriced-codex',
      model: 'llama-42-enormous',
      harness: 'codex-app-server',
      capabilities: ['build'],
      costTier: 10,
      spawnConfig: {},
    })

    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: agent.id, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, runtimeModel: 'gpt-5.3-codex-spark', runtimeHarness: 'codex-app-server',
      runtimeSandboxProfile: null, runtimeWorkflowProfile: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120, verifyRetries: 0,
    })

    await requestJson(fixture.app, `/api/runs/${run.id}/tokens`, {
      method: 'POST',
      body: { tokensIn: 12_345, tokensOut: 678, model: 'gpt-5.3-codex-spark' },
    })

    const after = fixture.repos.runs.get(run.id)
    expect(after?.tokensIn).toBe(12345)
    expect(after?.tokensOut).toBe(678)
    expect(after?.costUsd).toBe(0)
    expect(after?.terminalState).toBe('frozen')
    expect(after?.failReason).toMatch(/cost_budget_paused/)
    expect(after?.failReason).toMatch(/unpriced/i)
  })

  it('enforceCostBudget kills the run once perSpecHardUsd is crossed across multiple runs', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.context.costBudget = { perSpecHardUsd: 10 }
    const killed: string[] = []
    fixture.context.killRun = async (runId) => { killed.push(runId) }

    // Two runs on the same task, each at $4. Together $8 — under cap.
    const r1 = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
      stage: 'done', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.runs.updateTokens(r1.id, 0, 0, 4)

    const r2 = fixture.repos.runs.create({
      id: createId<'RunId'>(), taskId: task.id, agentId: builder.id, parentRunId: null,
      stage: 'implement', terminalState: null, resetCount: 0, completedStages: [],
      blockedReason: null, pendingApproval: false, sessionId: null,
      branch: null, commitSha: null, prNumber: null, prUrl: null,
      worktreePaths: null, ciStatus: null, reviewStatus: null,
      failReason: null, recoverable: true, tokensIn: 0, tokensOut: 0, costUsd: 0,
      lastHeartbeat: new Date().toISOString(), heartbeatTimeoutSeconds: 120,
    })
    fixture.repos.runs.updateTokens(r2.id, 0, 0, 4)

    let killedNow = await enforceCostBudget(fixture.context, r2.id)
    expect(killedNow).toBe(false)

    // Push r2 cost up so the spec total crosses 10.
    fixture.repos.runs.updateTokens(r2.id, 0, 0, 3)
    killedNow = await enforceCostBudget(fixture.context, r2.id)
    expect(killedNow).toBe(true)
    expect(killed).toEqual([r2.id])
    expect(fixture.repos.runs.get(r2.id)?.failReason).toMatch(/spec_cost_budget_paused/)
  })
})

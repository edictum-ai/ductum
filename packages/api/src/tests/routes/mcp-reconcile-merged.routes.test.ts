import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - MCP and merged reconcile', () => {
  it('POST /api/mcp/:runId returns 404 for an unknown run id (HTTP MCP transport bound by URL)', async () => {
    fixture = await createFixture()
    const result = await requestJson(fixture.app, '/api/mcp/does-not-exist', {
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })
    expect(result.response.status).toBe(404)
    expect(result.text).toMatch(/Run not found/)
  })

  it('protects HTTP MCP transport when operator auth is enabled', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })
    const denied = await requestJson(fixture.app, '/api/mcp/does-not-exist', {
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })
    const allowed = await requestJson(fixture.app, '/api/mcp/does-not-exist?ductum_operator_token=secret', {
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })

    expect(denied.response.status).toBe(401)
    expect(allowed.response.status).toBe(404)
  })

  it('allows HTTP MCP transport with a matching run control token', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })
    const { task, builder } = seedBase(fixture)
    const run = createMcpRun(fixture, task.id, builder.id, 'session-1')
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-1',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'run-control-token',
    })

    const allowed = await requestJson(fixture.app, `/api/mcp/${run.id}?ductum_control_token=run-control-token`, {
      method: 'POST',
      headers: { accept: 'application/json, text/event-stream' },
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })

    expect(allowed.response.status).toBe(200)
    expect(allowed.text).not.toMatch(/Operator token required/)
  })

  it('rejects HTTP MCP transport with a wrong or sibling run control token', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })
    const { task, builder } = seedBase(fixture)
    const run = createMcpRun(fixture, task.id, builder.id, 'session-1')
    const siblingTask = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: task.specId,
      name: 'Sibling',
      prompt: 'sibling task',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const sibling = createMcpRun(fixture, siblingTask.id, builder.id, 'session-2')
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-1',
      runId: run.id,
      harness: 'codex-sdk',
      controlToken: 'run-control-token',
    })
    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-2',
      runId: sibling.id,
      harness: 'codex-sdk',
      controlToken: 'sibling-control-token',
    })

    const wrong = await requestJson(fixture.app, `/api/mcp/${run.id}?ductum_control_token=wrong-token`, {
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })
    const siblingToken = await requestJson(fixture.app, `/api/mcp/${run.id}?ductum_control_token=sibling-control-token`, {
      method: 'POST',
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    })

    expect(wrong.response.status).toBe(401)
    expect(siblingToken.response.status).toBe(401)
  })

  it('returns 404 from the diff endpoint when the run has no worktree', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
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

    const diffResponse = await requestJson(fixture.app, `/api/runs/${run.id}/diff`)
    expect(diffResponse.response.status).toBe(404)
    expect(diffResponse.text).toMatch(/no worktree/i)
  })

  it('POST /api/runs/reconcile finds merged-but-not-done runs by git log and walks the parent chain', async () => {
    // Reproduce the zombie state from this session: an ancestor impl
    // run left at stage='ship' with branch=non-null, even though the
    // descendant fix run already merged. The merge commit on main
    // mentions the descendant's run id in the subject. Reconcile must:
    //   1. find the descendant run by grepping git log
    //   2. mark it done
    //   3. walk parentRunId and mark the impl ancestor done too
    const mergeFix = await setupMergeFixture()
    try {
      fixture = await createFixture()
      const { task, builder } = seedBase(fixture)

      // Implementation run — never marked done.
      const implRun = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: true,
        sessionId: null,
        branch: 'feature/x',
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
      // Descendant fix run — also never marked done.
      const fixRun = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: implRun.id,
        stage: 'ship',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: true,
        sessionId: null,
        branch: 'feature/x',
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

      // Manually merge feature/x into main with the canonical message
      // shape (`(run <id8>)`) so the reconcile grep finds it.
      await execFileAsync('git', ['-C', mergeFix.upstream, 'checkout', 'main'])
      await execFileAsync('git', [
        '-C', mergeFix.upstream,
        'merge', '--no-ff',
        '-m', `Merge feature/x (run ${fixRun.id.slice(0, 8)})\n\nApproved via Ductum factory.`,
        'feature/x',
      ])

      // Run the reconcile route. cwd points at the upstream we just
      // merged so the git log scan finds the merge commit.
      const previousCwd = process.cwd()
      process.chdir(mergeFix.upstream)
      try {
        const reconcileResponse = await requestJson(fixture.app, '/api/runs/reconcile', {
          method: 'POST',
          body: {},
        })
        expect(reconcileResponse.response.status).toBe(200)
        const result = reconcileResponse.json as {
          scannedRuns: number
          runsReconciled: Array<{
            runId: string
            reason: string
            disposition?: string
            mergeCommit?: string
            ancestorsMarkedDone?: string[]
            ancestorAudits?: Array<{ runId: string; audit: { evidenceId: string } }>
            audit?: { evidenceId: string; updateId: number }
          }>
        }
        expect(result.scannedRuns).toBeGreaterThanOrEqual(2)
        const fixEntry = result.runsReconciled.find((r) => r.runId === fixRun.id)
        expect(fixEntry?.reason).toBe('merged')
        expect(fixEntry?.disposition).toBe('completed-but-unrecorded')
        expect(fixEntry?.mergeCommit).toMatch(/^[0-9a-f]{40}$/)
        // Ancestor impl run was marked done as a side-effect.
        expect(fixEntry?.ancestorsMarkedDone).toContain(implRun.id)
        expect(fixEntry?.audit?.evidenceId).toEqual(expect.any(String))
        expect(fixEntry?.ancestorAudits?.[0]).toMatchObject({ runId: implRun.id })
      } finally {
        process.chdir(previousCwd)
      }

      // Both runs are now stage='done', terminal_state=null.
      const implAfter = fixture.repos.runs.get(implRun.id)!
      expect(implAfter.stage).toBe('done')
      expect(implAfter.terminalState).toBeNull()
      const fixAfter = fixture.repos.runs.get(fixRun.id)!
      expect(fixAfter.stage).toBe('done')
      expect(fixAfter.terminalState).toBeNull()
      expect(fixAfter.commitSha).toBeNull()
      expect(implAfter.commitSha).toBeNull()
      expect(fixture.repos.evidence.list(fixRun.id).at(-1)?.payload).toMatchObject({
        kind: 'state-reconcile',
        reason: 'merged',
      })
      expect(fixture.repos.runUpdates.list(implRun.id).at(-1)?.message).toContain('reconcile merged')
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

function createMcpRun(
  fixture: TestFixture,
  taskId: Run['taskId'],
  agentId: Run['agentId'],
  sessionId: string,
): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage: 'understand',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId,
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

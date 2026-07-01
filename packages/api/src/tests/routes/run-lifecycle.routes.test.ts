import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - run lifecycle', () => {
  it('records implementation completion without marking a non-ship run done', async () => {
    fixture = await createFixture({ hasActiveSession: () => true })
    const { task, builder } = seedBase(fixture)

    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    const runId = (accept.json as { id: string }).id
    expect(accept.response.status).toBe(201)

    const gate = await requestJson(fixture.app, `/api/runs/${runId}/gate-check`, {
      method: 'POST',
      body: {},
    })
    // gate-check is now a read-only workflow status query; returns current stage
    expect((gate.json as { stage: string }).stage).toBe('understand')

    const complete = await requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST',
      body: { result: 'implemented' },
    })
    expect((complete.json as { stage: string }).stage).toBe('understand')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')

    expect((await requestJson(fixture.app, `/api/tasks/${task.id}/runs`)).response.status).toBe(200)
    expect((await requestJson(fixture.app, `/api/runs/${runId}`)).response.status).toBe(200)
    expect((await requestJson(fixture.app, `/api/tasks/${task.id}/context`)).response.status).toBe(200)
  })

  it('POST /api/runs/:id/complete requests session teardown automatically', async () => {
    const endSession = vi.fn(async () => undefined)
    fixture = await createFixture({ endSession, hasActiveSession: () => true })
    const { task, builder } = seedBase(fixture)

    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    const runId = (accept.json as { id: string }).id

    const complete = await requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST',
      body: { result: 'implemented enough detail to exercise automatic teardown' },
    })
    expect(complete.response.status).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(endSession).toHaveBeenCalledWith(runId)
  })

  it('only marks a run done once it is in workflow done', async () => {
    fixture = await createFixture({ hasActiveSession: () => true })
    const { task, builder } = seedBase(fixture)

    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    const runId = (accept.json as { id: string }).id

    const beforeDone = await requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST',
      body: { result: 'ship requested' },
    })
    expect((beforeDone.json as { stage: string }).stage).toBe('understand')

    fixture.repos.runs.updateStage(runId as never, 'done')

    const complete = await requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST',
      body: { result: 'shipped' },
    })
    expect((complete.json as { stage: string }).stage).toBe('done')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('done')
  })

  it('streams SSE events for run state changes', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accept.json as { id: string }).id
    fixture.repos.runs.updateStage(runId as never, 'done')

    const controller = new AbortController()
    const response = await fixture.app.request(`/api/events/stream?runId=${runId}`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    })
    const reader = response.body?.getReader()
    expect(response.status).toBe(200)
    expect(reader).toBeDefined()
    expect(await waitForSse(reader!, 'event: ready')).toContain('data: {}')

    await new Promise((resolve) => setTimeout(resolve, 0))

    void requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST',
      body: { result: 'done' },
    })

    const payload = await waitForSse(reader!, 'event: run.stage_changed')
    expect(payload).toContain(`"runId":"${runId}"`)
    controller.abort()
    await reader?.cancel()
  })

  it('rejects operator token in the SSE query string and accepts the header', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })
    const denied = await fixture.app.request('/api/events/stream', {
      headers: { accept: 'text/event-stream' },
    })
    expect(denied.status).toBe(401)

    const queryToken = await fixture.app.request('/api/events/stream?ductum_operator_token=secret', {
      headers: { accept: 'text/event-stream' },
    })
    expect(queryToken.status).toBe(401)

    const controller = new AbortController()
    const allowed = await fixture.app.request('/api/events/stream', {
      signal: controller.signal,
      headers: { accept: 'text/event-stream', 'x-ductum-operator-token': 'secret' },
    })
    expect(allowed.status).toBe(200)
    controller.abort()
    await allowed.body?.cancel()
  })

  it('returns expected error codes for missing resources and invalid transitions', async () => {
    fixture = await createFixture()
    const missing = await requestJson(fixture.app, '/api/agents/missing')
    expect(missing.response.status).toBe(404)

    const { task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accept.json as { id: string }).id

    // gate-check is now read-only — always succeeds for a valid run
    const gate2 = await requestJson(fixture.app, `/api/runs/${runId}/gate-check`, {
      method: 'POST',
      body: {},
    })
    expect(gate2.response.status).toBe(200)
  })

  it('accepts early harness session ids before the dispatcher mapping exists', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    const runId = (accept.json as { id: string }).id

    const early = await requestJson(fixture.app, `/api/runs/${runId}/harness-session-id`, {
      method: 'POST',
      body: { harnessSessionId: 'thread-1' },
    })
    expect(early.response.status).toBe(202)
    expect(fixture.repos.sessionRunMappings.getByRunId(runId as never)).toBeNull()

    fixture.repos.sessionRunMappings.create({
      sessionId: 'session-1',
      runId: runId as never,
      harness: 'codex-sdk',
    })
    const recorded = await requestJson(fixture.app, `/api/runs/${runId}/harness-session-id`, {
      method: 'POST',
      body: { harnessSessionId: 'thread-1' },
    })
    expect(recorded.response.status).toBe(200)
    expect(fixture.repos.sessionRunMappings.getByRunId(runId as never)?.harnessSessionId).toBe('thread-1')
  })

  it('blocks task dependency cycles', async () => {
    fixture = await createFixture()
    const { spec, builder } = seedBase(fixture)

    const taskA = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'A', assignedAgentId: builder.id },
    })
    const taskB = await requestJson(fixture.app, `/api/specs/${spec.id}/tasks`, {
      method: 'POST',
      body: { name: 'B', assignedAgentId: builder.id },
    })
    const taskAId = (taskA.json as { id: string }).id
    const taskBId = (taskB.json as { id: string }).id

    expect(
      (await requestJson(fixture.app, `/api/tasks/${taskBId}/dependencies`, {
        method: 'POST',
        body: { dependsOnId: taskAId },
      })).response.status,
    ).toBe(201)

    const cycle = await requestJson(fixture.app, `/api/tasks/${taskAId}/dependencies`, {
      method: 'POST',
      body: { dependsOnId: taskBId },
    })
    expect(cycle.response.status).toBe(400)
    expect((cycle.json as { error: string }).error).toContain('cycle')
  })

  it('requires a session control token for internal workflow control routes', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'understand',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: 'session-1',
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
    const mapping = fixture.repos.sessionRunMappings.create({
      sessionId: 'session-1',
      runId: run.id,
      harness: 'codex-sdk',
    })

    const publicRoute = await fixture.app.request(`/api/runs/${run.id}/authorize-tool`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'Read', args: { file_path: 'README.md' } }),
    })
    expect(publicRoute.status).toBe(404)

    const missingToken = await requestJson(fixture.app, '/api/internal/authorize-tool', {
      method: 'POST',
      body: { sessionId: 'session-1', tool: 'Read', args: { file_path: 'README.md' } },
    })
    expect(missingToken.response.status).toBe(400)

    const invalidToken = await requestJson(fixture.app, '/api/internal/authorize-tool', {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: 'wrong-token' },
      body: { sessionId: 'session-1', tool: 'Read', args: { file_path: 'README.md' } },
    })
    expect(invalidToken.response.status).toBe(403)

    const allowed = await requestJson(fixture.app, '/api/internal/authorize-tool', {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: mapping.controlToken },
      body: { sessionId: 'session-1', tool: 'Read', args: { file_path: 'README.md' } },
    })
    expect(allowed.response.status).toBe(200)

    // Bash with git push is blocked at understand stage (only Read/Grep/Glob/Bash allowed, but git push is explicitly blocked)
    const blocked = await requestJson(fixture.app, '/api/internal/authorize-tool', {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: mapping.controlToken },
      body: { sessionId: 'session-1', tool: 'Bash', args: { command: 'git push origin HEAD' } },
    })
    expect(blocked.response.status).toBe(403)

    const reported = await requestJson(fixture.app, '/api/internal/report-tool-success', {
      method: 'POST',
      headers: { [SESSION_CONTROL_TOKEN_HEADER]: mapping.controlToken },
      body: { sessionId: 'session-1', tool: 'Read', args: { file_path: 'README.md' } },
    })
    expect(reported.response.status).toBe(200)
  })

})

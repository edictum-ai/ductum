import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - health and runs', () => {
  it('exposes health check', async () => {
    fixture = await createFixture()
    const health = await requestJson(fixture.app, '/api/health')
    expect(health.response.status).toBe(200)
    expect(health.json).toEqual({ ok: true, operatorTokenProtected: false })
  })

  it('reports operator token protection on /api/health when the API requires a token', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })
    const health = await requestJson(fixture.app, '/api/health')
    expect(health.response.status).toBe(200)
    expect(health.json).toEqual({ ok: true, operatorTokenProtected: true })
  })

  it('POST /api/internal/session/reconnect sets a local browser session without raw token detect', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousDetect = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'secret' })
      const reconnected = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: sameOriginHeaders(),
      })
      expect(reconnected.response.status).toBe(200)
      expect(reconnected.json).toMatchObject({ ok: true })
      const cookie = reconnected.response.headers.get('set-cookie') ?? ''
      expect(cookie).toContain('ductum_operator_token=dos_')
      expect(cookie).not.toContain('secret')
      expect(JSON.stringify(reconnected.json)).not.toContain('secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousDetect)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('POST /api/internal/session/reconnect refuses public API exposure', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_PUBLIC_BASE_URL = 'https://factory.example.com'
    try {
      fixture = await createFixture({ operatorToken: 'secret' })
      const reconnected = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: sameOriginHeaders(),
      })
      expect(reconnected.response.status).toBe(403)
      expect(reconnected.json).toMatchObject({ ok: false })
      expect(reconnected.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('GET /api/resolve/runs/:runId returns project/spec/task context for a known run', async () => {
    fixture = await createFixture()
    const { project, spec, task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: task.id, agentId: builder.id },
    })
    const runId = (accept.json as { id: string }).id

    const resolved = await requestJson(fixture.app, `/api/resolve/runs/${runId}`)
    expect(resolved.response.status).toBe(200)
    const body = resolved.json as {
      project: { id: string }
      spec: { id: string }
      task: { id: string }
      run: { id: string }
    }
    expect(body.project.id).toBe(project.id)
    expect(body.spec.id).toBe(spec.id)
    expect(body.task.id).toBe(task.id)
    expect(body.run.id).toBe(runId)
  })

  it('GET /api/resolve accepts spec and task ids as slug fallbacks', async () => {
    fixture = await createFixture()
    const { project, spec, task } = seedBase(fixture)

    const resolved = await requestJson(fixture.app, `/api/resolve/${project.name}/${spec.id}/${task.id}`)
    expect(resolved.response.status).toBe(200)
    const body = resolved.json as {
      project: { id: string }
      spec: { id: string }
      task: { id: string }
    }
    expect(body.project.id).toBe(project.id)
    expect(body.spec.id).toBe(spec.id)
    expect(body.task.id).toBe(task.id)
  })

  it('GET /api/resolve/runs/:runId returns 404 for an unknown run id (not "Project not found")', async () => {
    fixture = await createFixture()
    const resolved = await requestJson(fixture.app, '/api/resolve/runs/not-a-real-runid')
    expect(resolved.response.status).toBe(404)
    expect((resolved.json as { error: string }).error).toContain('Run not found')
  })

  it('GET /api/internal/operator-token-detect never returns the raw operator token', async () => {
    const previous = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'secret' })
      const detected = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: sameOriginHeaders(),
      })
      expect(detected.response.status).toBe(410)
      expect(detected.json).toMatchObject({ ok: false })
      expect(detected.text).toContain('Raw operator token detection has been removed')
      expect(detected.text).not.toContain('secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previous)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('GET /api/internal/operator-token-detect stays removed when the API binds publicly', async () => {
    const previous = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '0.0.0.0'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'secret' })
      const detected = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: sameOriginHeaders(),
      })
      expect(detected.response.status).toBe(410)
      expect(detected.json).toMatchObject({ ok: false })
      expect(detected.text).not.toContain('secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previous)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('GET /api/runs returns one row per run even when the agent has multiple project roles', async () => {
    // Regression: an agent with multiple roles in project_agents must
    // produce one enriched row per run, not one per (run × role).
    fixture = await createFixture()
    const { task, builder, project } = seedBase(fixture)
    // Give the builder additional roles in the same project.
    fixture.repos.projectAgents.assign({
      projectId: project.id,
      agentId: builder.id,
      role: 'reviewer',
    })
    fixture.repos.projectAgents.assign({
      projectId: project.id,
      agentId: builder.id,
      role: 'docs',
    })
    fixture.repos.runs.create({
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
      sessionId: 'session-multirole',
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

    const result = await requestJson(fixture.app, '/api/runs')
    expect(result.response.status).toBe(200)
    const runs = result.json as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    const row = runs[0]!
    expect(row.agentName).toBe(builder.name)
  })

  it('GET /api/runs returns enriched rows with task/spec/project/agent context', async () => {
    fixture = await createFixture()
    const { task, builder, spec, project } = seedBase(fixture)
    fixture.repos.runs.create({
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
      sessionId: 'session-enriched',
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

    const result = await requestJson(fixture.app, '/api/runs')
    expect(result.response.status).toBe(200)
    const runs = result.json as Array<Record<string, unknown>>
    expect(runs).toHaveLength(1)
    const row = runs[0]!
    expect(row.taskName).toBe(task.name)
    expect(row.specName).toBe(spec.name)
    expect(row.projectName).toBe(project.name)
    expect(row.agentName).toBe(builder.name)
    expect(row.agentModel).toBe(builder.model)
    expect(row.retryCount).toBe(0)
    // Base Run fields still present so existing consumers keep working.
    expect(row.id).toBeDefined()
    expect(row.stage).toBe('implement')
  })

})

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) delete process.env[name]
  else process.env[name] = value
}

function sameOriginHeaders(): Record<string, string> {
  return { host: '127.0.0.1:4100', origin: 'http://127.0.0.1:4100' }
}

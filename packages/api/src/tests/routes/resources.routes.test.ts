import { SESSION_CONTROL_TOKEN_HEADER, createFixture, createId, describe, enforceCostBudget, execFileAsync, expect, mkdtemp, it, join, mergeApprovedRun, precheckCostBudget, registerRouteTestCleanup, requestJson, rm, seedBase, setupFakeGh, setupMergeFixture, tmpdir, vi, waitForSse, workflowProfilePath, writeFile, type Run, type TestFixture } from './shared.js'
let fixture: TestFixture | undefined; registerRouteTestCleanup(() => fixture, () => { fixture = undefined }); describe('API routes - resources', () => {
  it('supports CRUD flows across factory, projects, agents, specs, tasks, and decisions', async () => {
    fixture = await createFixture()

    const factory = await requestJson(fixture.app, '/api/factory', {
      method: 'PUT',
      body: {
        name: 'Ductum',
        config: { heartbeatTimeoutSeconds: 90, defaultMergeMode: 'auto' },
      },
    })
    expect(factory.response.status).toBe(201)

    const project = await requestJson(fixture.app, '/api/projects', {
      method: 'POST',
      body: {
        name: 'ductum',
        repos: ['ductum-ai/ductum'],
        config: {
          mergeMode: 'auto',
          workflowPath: 'workflows/coding-guard.yaml',
          workflowProfile: workflowProfilePath,
          externalReviewRequired: true,
        },
      },
    })
    const projectId = (project.json as { id: string }).id
    expect(project.response.status).toBe(201)
    expect((project.json as { config: { workflowProfile?: string } }).config.workflowProfile).toBe(
      workflowProfilePath,
    )
    expect((project.json as { config: { externalReviewRequired?: boolean } }).config.externalReviewRequired).toBe(true)

    const agent = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'mimi',
        model: 'claude-opus-4.6',
        harness: 'claude-agent-sdk',
        capabilities: ['build', 'test'],
        spawnConfig: { workingDir: '/tmp/ductum' },
      },
    })
    const agentId = (agent.json as { id: string }).id
    expect(agent.response.status).toBe(201)

    const assignment = await requestJson(fixture.app, `/api/projects/${projectId}/agents`, {
      method: 'POST',
      body: { agentId, role: 'builder' },
    })
    expect(assignment.response.status).toBe(201)

    const spec = await requestJson(fixture.app, `/api/projects/${projectId}/specs`, {
      method: 'POST',
      body: { name: 'P4', status: 'approved', document: '# P4' },
    })
    const specId = (spec.json as { id: string }).id
    expect(spec.response.status).toBe(201)

    const otherSpec = await requestJson(fixture.app, `/api/projects/${projectId}/specs`, {
      method: 'POST',
      body: { name: 'P3', status: 'done', document: '# P3' },
    })
    const otherSpecId = (otherSpec.json as { id: string }).id
    const specDep = await requestJson(fixture.app, `/api/specs/${specId}/dependencies`, {
      method: 'POST',
      body: { dependsOnId: otherSpecId, kind: 'hard' },
    })
    expect(specDep.response.status).toBe(201)

    const task = await requestJson(fixture.app, `/api/specs/${specId}/tasks`, {
      method: 'POST',
      body: {
        name: 'REST API',
        prompt: 'implement',
        repos: ['packages/api'],
        assignedAgentId: agentId,
        verification: ['pnpm test'],
      },
    })
    const taskId = (task.json as { id: string }).id
    expect(task.response.status).toBe(201)

    const taskRead = await requestJson(fixture.app, `/api/tasks/${taskId}`)
    expect(taskRead.response.status).toBe(200)

    const decision = await requestJson(fixture.app, '/api/decisions', {
      method: 'POST',
      body: {
        specId,
        taskId,
        decision: 'Use Hono',
        context: 'Lightweight REST layer',
        alternatives: ['Express'],
        decidedBy: 'codex',
      },
    })
    expect(decision.response.status).toBe(201)

    const listedDecisions = await requestJson(fixture.app, `/api/decisions?specId=${specId}`)
    expect((listedDecisions.json as unknown[])).toHaveLength(1)

    const projectUpdate = await requestJson(fixture.app, `/api/projects/${projectId}`, {
      method: 'PUT',
      body: {
        name: 'ductum-renamed',
        repos: ['ductum-ai/ductum', 'edictum-ai/edictum-ts'],
      },
    })
    expect((projectUpdate.json as { name: string }).name).toBe('ductum-renamed')

    const specStatus = await requestJson(fixture.app, `/api/specs/${specId}/status`, {
      method: 'PUT',
      body: { status: 'implementing' },
    })
    expect((specStatus.json as { status: string }).status).toBe('implementing')
    const deps = await requestJson(fixture.app, `/api/tasks/${taskId}/dependencies`)
    expect((deps.json as unknown[])).toEqual([])

    expect((await requestJson(fixture.app, '/api/projects')).json).toHaveLength(1)
    expect((await requestJson(fixture.app, '/api/agents')).json).toHaveLength(1)
    expect((await requestJson(fixture.app, `/api/projects/${projectId}/agents`)).json).toHaveLength(1)

    expect((await requestJson(fixture.app, `/api/specs/${specId}`)).response.status).toBe(200)
    expect((await requestJson(fixture.app, `/api/projects/${projectId}/specs`)).response.status).toBe(200)
    expect((await requestJson(fixture.app, `/api/specs/${specId}/dependencies`)).response.status).toBe(200)

    expect((await requestJson(fixture.app, `/api/specs/${specId}/tasks`)).response.status).toBe(200)

    expect((await requestJson(fixture.app, `/api/projects/${projectId}/agents/${agentId}`, { method: 'DELETE' })).response.status).toBe(204)
    expect((await requestJson(fixture.app, `/api/tasks/${taskId}`, { method: 'DELETE' })).response.status).toBe(204)
    expect((await requestJson(fixture.app, `/api/specs/${specId}/dependencies/${otherSpecId}`, { method: 'DELETE' })).response.status).toBe(204)
    expect((await requestJson(fixture.app, `/api/specs/${specId}`, { method: 'DELETE' })).response.status).toBe(200)
    expect((await requestJson(fixture.app, `/api/agents/${agentId}`, { method: 'DELETE' })).response.status).toBe(204)
  })

  it('returns the model catalog and validates agent models by harness', async () => {
    fixture = await createFixture()

    const catalog = await requestJson(fixture.app, '/api/models')
    expect(catalog.response.status).toBe(200)
    const models = (catalog.json as {
      models: Array<{
        id: string
        providerModelId: string
        availability: string
        pricingState: string
        lastVerifiedAt: string
        supportedEfforts?: string[]
        supportedHarnesses: string[]
      }>
    }).models
    expect(models.some((m) => m.id === 'gpt-5.4')).toBe(true)
    expect(models.some((m) => m.id === 'gpt-5.5-pro')).toBe(true)
    expect(models.find((m) => m.id === 'claude-fable-5')).toMatchObject({
      availability: 'deprecated',
      supportedHarnesses: [],
    })
    expect(models.some((m) => m.id === 'claude-opus-4-8')).toBe(true)
    expect(models.some((m) => m.id === 'claude-opus-4-7')).toBe(true)
    expect(models.some((m) => m.id === 'glm-5.2')).toBe(true)
    expect(models.some((m) => m.id === 'glm-5.1')).toBe(true)
    expect(models.some((m) => m.id === 'glm-5v-turbo')).toBe(true)
    expect(models.some((m) => m.id === 'glm-5v')).toBe(false)
    expect(models.some((m) => m.id === 'glm-4.5-air')).toBe(true)
    expect(models.find((m) => m.id === 'gpt-5.4')).toMatchObject({ availability: 'codex', supportedEfforts: expect.arrayContaining(['xhigh']) })
    expect(models.find((m) => m.id === 'gpt-5.5-pro')).toMatchObject({ availability: 'api', supportedHarnesses: [] })
    expect(models.find((m) => m.id === 'gpt-5.4-pro')).toMatchObject({
      availability: 'api',
      supportedEfforts: expect.arrayContaining(['xhigh']),
      supportedHarnesses: [],
    })
    expect(models.find((m) => m.id === 'gpt-5.3-codex-spark')).toMatchObject({
      availability: 'research-preview',
      pricingState: 'unmeasured',
      providerModelId: 'gpt-5.3-codex-spark',
      lastVerifiedAt: '2026-06-13',
    })
    expect(models.find((m) => m.id === 'claude-opus-4-8')).toMatchObject({ availability: 'subscription', supportedEfforts: expect.arrayContaining(['xhigh', 'max']) })
    expect(models.find((m) => m.id === 'claude-opus-4-7')).toMatchObject({ availability: 'subscription', supportedEfforts: expect.arrayContaining(['xhigh', 'max']) })
    expect(models.find((m) => m.id === 'glm-5.2')).toMatchObject({
      availability: 'coding-plan',
      pricingState: 'measured',
      supportedHarnesses: ['claude-agent-sdk'],
      supportedEfforts: expect.arrayContaining(['xhigh', 'max']),
    })
    expect(models.find((m) => m.id === 'glm-5v-turbo')).toMatchObject({ availability: 'api', pricingState: 'measured' })

    const ok = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'codex', model: 'openai/gpt-5.4', harness: 'codex-sdk', capabilities: ['build'], effort: 'xhigh' },
    })
    expect(ok.response.status).toBe(201)
    expect((ok.json as { model: string; costTier: number; effort: string }).model).toBe('gpt-5.4')
    expect((ok.json as { model: string; costTier: number; effort: string }).costTier).toBe(85)
    expect((ok.json as { model: string; costTier: number; effort: string }).effort).toBe('xhigh')

    const bad = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad', model: 'gpt-5.5', harness: 'claude-agent-sdk', capabilities: ['build'] },
    })
    expect(bad.response.status).toBe(400)
    expect((bad.json as { error: string }).error).toContain('not supported by Harness adapter type')

    const badEffort = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad-effort', model: 'glm-5.1', harness: 'claude-agent-sdk', capabilities: ['build'], effort: 'xhigh' },
    })
    expect(badEffort.response.status).toBe(400)
    expect((badEffort.json as { error: string }).error).toContain('Effort xhigh is not supported')

    const badZaiHarness = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad-zai', model: 'glm-5', harness: 'claude-agent-sdk', capabilities: ['build'] },
    })
    expect(badZaiHarness.response.status).toBe(400)
    expect((badZaiHarness.json as { error: string }).error).toContain('not supported by Harness adapter type')

    const badProHarness = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: { name: 'bad-pro', model: 'gpt-5.5-pro', harness: 'codex-sdk', capabilities: ['build'] },
    })
    expect(badProHarness.response.status).toBe(400)
    expect((badProHarness.json as { error: string }).error).toContain('not supported by Harness adapter type')
  })

  it('redacts agent env secrets from public agent routes', async () => {
    fixture = await createFixture()

    const rejected = await requestJson(fixture.app, '/api/agents', {
      method: 'POST',
      body: {
        name: 'glm',
        model: 'glm-5.1',
        harness: 'claude-agent-sdk',
        capabilities: ['build'],
        spawnConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic' } },
      },
    })
    expect(rejected.response.status).toBe(400)
    expect(rejected.text).not.toContain('secret-token')

    const stored = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'glm',
      model: 'glm-5.1',
      harness: 'claude-agent-sdk',
      capabilities: ['build'],
      costTier: 10,
      spawnConfig: { env: { ANTHROPIC_AUTH_TOKEN: 'secret-token', ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic' } },
    })
    const agentId = stored.id
    expect(fixture.repos.agents.get(agentId as never)?.spawnConfig.env?.ANTHROPIC_AUTH_TOKEN).toBe('secret-token')

    const listed = await requestJson(fixture.app, '/api/agents')
    expect(JSON.stringify(listed.json)).not.toContain('secret-token')
    const read = await requestJson(fixture.app, `/api/agents/${agentId}`)
    expect(JSON.stringify(read.json)).not.toContain('secret-token')
  })
})

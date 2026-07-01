import type { Agent, ProjectId } from '@ductum/core'
import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'
import { createId, describe, expect, it, registerRouteTestCleanup } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - bakeoff reviewer model policy', () => {
  it('allows an explicit Opus 4.8 reviewer when a Sonnet 5 builder is present', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const gptBuilder = createProjectAgent(project.id, 'gpt55-builder', 'gpt-5.5', 'builder')
    const sonnetBuilder = createProjectAgent(project.id, 'sonnet5-builder', 'claude-sonnet-5', 'builder')
    const opusReviewer = createProjectAgent(project.id, 'opus48-reviewer', 'claude-opus-4.8', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Opus judge',
        prompt: 'Pick the better implementation',
        builderAgentIds: [gptBuilder.id, sonnetBuilder.id],
        reviewerAgentId: opusReviewer.id,
      },
    })

    expect(result.response.status).toBe(201)
    expect((result.json as BakeoffCreateResponse).reviewer.id).toBe(opusReviewer.id)
  })

  it('allows an explicit GLM 5.2 reviewer when builder models differ', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const gptBuilder = createProjectAgent(project.id, 'gpt55-builder', 'gpt-5.5', 'builder')
    const opusBuilder = createProjectAgent(project.id, 'opus48-builder', 'claude-opus-4.8', 'builder')
    const glmReviewer = createProjectAgent(project.id, 'glm52-reviewer', 'glm-5.2', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'GLM judge',
        prompt: 'Pick the better implementation',
        builderAgentIds: [gptBuilder.id, opusBuilder.id],
        reviewerAgentId: glmReviewer.id,
      },
    })

    expect(result.response.status).toBe(201)
    expect((result.json as BakeoffCreateResponse).reviewer.id).toBe(glmReviewer.id)
  })

  it('defaults to a non-Claude reviewer when Claude builders exist and GPT 5.5 is absent', async () => {
    fixture = await createFixture()
    const { project, reviewer } = seedBase(fixture)
    const opusBuilder = createProjectAgent(project.id, 'opus48-builder', 'claude-opus-4.8', 'builder')
    const sonnetBuilder = createProjectAgent(project.id, 'sonnet5-builder', 'claude-sonnet-5', 'builder')
    const glmReviewer = createProjectAgent(project.id, 'glm52-reviewer', 'glm-5.2', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Fallback judge',
        prompt: 'Pick the better implementation',
        builderAgentIds: [opusBuilder.id, sonnetBuilder.id],
      },
    })

    expect(result.response.status).toBe(201)
    const selected = (result.json as BakeoffCreateResponse).reviewer
    expect([reviewer.id, glmReviewer.id]).toContain(selected.id)
    expect(selected.model).not.toContain('claude')
  })

  it('allows a four-model omission when the operator records a doctor-proven model block', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm52-builder', 'glm-5.2', 'builder')
    const gpt = createProjectAgent(project.id, 'gpt55-builder', 'gpt-5.5', 'builder')
    const opus = createProjectAgent(project.id, 'opus48-builder', 'claude-opus-4.8', 'builder')
    createProjectAgent(project.id, 'sonnet5-builder', 'claude-sonnet-5', 'builder')
    const judge = createProjectAgent(project.id, 'judge', 'gpt-5.4', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Doctor-blocked matrix',
        prompt: 'Do it',
        builderAgentIds: [glm.id, gpt.id, opus.id],
        reviewerAgentId: judge.id,
        doctorBlockedModels: ['claude-sonnet-5'],
      },
    })

    expect(result.response.status).toBe(201)
  })

  it('rejects four-model matrix omissions when all required builders are configured', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    const glm = createProjectAgent(project.id, 'glm52-builder', 'glm-5.2', 'builder')
    const gpt = createProjectAgent(project.id, 'gpt55-builder', 'gpt-5.5', 'builder')
    const opus = createProjectAgent(project.id, 'opus48-builder', 'claude-opus-4.8', 'builder')
    createProjectAgent(project.id, 'sonnet5-builder', 'claude-sonnet-5', 'builder')
    const judge = createProjectAgent(project.id, 'judge', 'gpt-5.4', 'reviewer')

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Incomplete matrix',
        prompt: 'Do it',
        builderAgentIds: [glm.id, gpt.id, opus.id],
        reviewerAgentId: judge.id,
      },
    })

    expect(result.response.status).toBe(400)
    expect((result.json as { error: string }).error).toContain('omits configured routable model')
  })
})

interface BakeoffCreateResponse { reviewer: Agent }

function createProjectAgent(projectId: ProjectId, name: string, model: string, role: 'builder' | 'reviewer'): Agent {
  if (fixture == null) throw new Error('fixture not set')
  const agent = fixture.repos.agents.create({
    id: createId<'AgentId'>(),
    name,
    model,
    harness: 'codex-sdk',
    capabilities: role === 'builder' ? ['build', 'test'] : ['review'],
    costTier: role === 'builder' ? 40 : 80,
    spawnConfig: {},
  })
  fixture.repos.projectAgents.assign({ projectId, agentId: agent.id, role })
  return agent
}

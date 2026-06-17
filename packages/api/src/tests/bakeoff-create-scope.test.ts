import { createId } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('bakeoff create source scope', () => {
  let fixture: TestFixture | null = null

  afterEach(() => {
    fixture?.close()
    fixture = null
  })

  it('applies repository and component scope to candidates and blind review', async () => {
    fixture = await createFixture()
    const { project, builder } = seedBase(fixture)
    const glm = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'glm-builder',
      model: 'glm-5.2',
      harness: 'codex-sdk',
      capabilities: ['build', 'test'],
      costTier: 50,
      spawnConfig: {},
    })
    fixture.repos.projectAgents.assign({ projectId: project.id, agentId: glm.id, role: 'builder' })
    const reviewer = fixture.repos.agents.create({
      id: createId<'AgentId'>(),
      name: 'gpt55-reviewer',
      model: 'gpt-5.5',
      harness: 'codex-sdk',
      capabilities: ['review'],
      costTier: 80,
      spawnConfig: {},
    })
    fixture.repos.projectAgents.assign({ projectId: project.id, agentId: reviewer.id, role: 'reviewer' })
    const repository = fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { localPath: '/Users/acartagena/project/ductum' },
    })
    const component = fixture.repos.components.create({
      id: createId<'ComponentId'>() as never,
      repositoryId: repository.id,
      name: 'api',
      spec: { path: 'packages/api' },
    })

    const result = await requestJson(fixture.app, `/api/projects/${project.id}/bakeoffs`, {
      method: 'POST',
      body: {
        name: 'Scoped bakeoff',
        prompt: 'Patch the API',
        builderAgentIds: [builder.id, glm.id],
        reviewerAgentId: reviewer.id,
        repositoryId: repository.id,
        componentId: component.id,
      },
    })

    expect(result.response.status).toBe(201)
    const payload = result.json as {
      candidates: Array<{ repositoryId: string; componentId: string; repos: string[] }>
      reviewTask: { repositoryId: string; componentId: string; repos: string[] }
    }
    expect(payload.candidates).toHaveLength(2)
    for (const task of [...payload.candidates, payload.reviewTask]) {
      expect(task).toMatchObject({
        repositoryId: repository.id,
        componentId: component.id,
        repos: ['/Users/acartagena/project/ductum'],
      })
    }
  })
})

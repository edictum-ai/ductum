import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createId } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

describe('sandbox runtime preflight unsupported claims', () => {
  let fixture: TestFixture
  let seeded: ReturnType<typeof seedBase>

  beforeEach(async () => {
    fixture = await createFixture()
    seeded = seedBase(fixture)
  })

  afterEach(() => {
    fixture.close()
  })

  it.each([
    ['filesystem', { provider: 'host', mode: 'worktree', filesystem: { root: '/tmp/ductum' } }, 'filesystem.root'],
    ['network', { provider: 'host', mode: 'worktree', network: { mode: 'none' } }, 'network.mode=none'],
    ['credentials', { provider: 'host', mode: 'worktree', credentials: { expose: ['github'] } }, 'spec.credentials'],
    ['resources', { provider: 'host', mode: 'worktree', resources: { cpu: 2 } }, 'spec.resources'],
    ['process', { provider: 'host', mode: 'worktree', process: { uid: 1000 } }, 'spec.process'],
  ] as const)('rejects project-scoped unsupported %s claims before accept creates a run', async (_name, spec, expected) => {
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: seeded.project.id,
      name: 'project-claimed-sandbox',
      spec,
    })
    fixture.repos.agents.update(seeded.builder.id, { resourceRefs: { sandboxRef: 'project-claimed-sandbox' } })

    const accepted = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST',
      body: { taskId: seeded.task.id },
    })

    expect(accepted.response.status).toBe(400)
    expect(accepted.json).toMatchObject({ error: expect.stringContaining(expected) })
    expect(fixture.repos.runs.list(seeded.task.id)).toEqual([])
  })
})

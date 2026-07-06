import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { evaluateAdoptionCiGate } from '../lib/operator-pr-adoption-gates.js'
import { createFixture, seedBase, type TestFixture } from './helpers.js'
import {
  buildGreenCheckRunsResponse,
  seedFactorySecretDir,
  seedRepositoryWithAuth,
} from './routes/github-app-merge-shared.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  fixture?.close()
  fixture = undefined
})

describe('operator PR adoption gates', () => {
  it('uses configured required checks instead of branch-protection fallback', async () => {
    const factoryDir = seedFactorySecretDir()
    fixture = await createFixture({
      factoryDataDir: factoryDir,
      merge: {
        push: false,
        base: 'main',
        strategy: 'merge',
        approvalCiGate: {
          enabled: true,
          requiredChecks: ['deploy-preview'],
          failClosedOnMissing: true,
        },
      },
    })
    const { project, builder, spec } = seedBase(fixture)
    const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
    const task = fixture.repos.tasks.create({
      id: createId<'TaskId'>(),
      specId: spec.id,
      repositoryId: repository.id,
      targetId: null,
      componentId: null,
      name: 'Adopt operator PR',
      prompt: 'adopt existing PR',
      repos: ['packages/api'],
      assignedAgentId: builder.id,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: ['pnpm test'],
    })
    const headSha = 'abc123'
    const green = buildGreenCheckRunsResponse(headSha)
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith(green.checkRunsUrl)) {
        return new Response(JSON.stringify({
          check_runs: [{ name: 'build-and-test', status: 'completed', conclusion: 'success' }],
        }), { status: 200 })
      }
      if (url.endsWith(green.statusesUrl)) return new Response(green.statusesBody, { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const decision = await evaluateAdoptionCiGate(
      fixture.context,
      { id: 'run-1' as never, taskId: task.id, prNumber: 42, prUrl: null, commitSha: headSha },
      headSha,
      'main',
    )

    expect(decision.ok).toBe(false)
    expect(decision.requiredChecksSource).toBe('policy')
    expect(decision.resolvedRequiredChecks).toEqual(['deploy-preview'])
    expect(decision.missingRequired).toEqual(['deploy-preview'])
    expect(decision.reasons).toContain('required check "deploy-preview" is missing')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(green.branchProtectionUrl))).toBe(false)
  })
})

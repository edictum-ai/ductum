import { afterEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@ductum/core'

import { stubIssueFetch } from './github-issue-intake.helpers.js'
import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fixture?.close()
  fixture = undefined
})

describe('GitHub issue prompt-section intake', () => {
  it('imports explicit implementation/review prompt sections from body/comments without mixing review text into the implementer prompt', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
    vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    vi.stubGlobal('fetch', stubIssueFetch({
      number: 48,
      title: 'factory: import prompts from issue',
      body: ['# Legacy issue', '', '## Implementation Prompt', 'Implement prompt import support.'].join('\n'),
      comments: [{ id: 1, html_url: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1', body: ['## Review Prompt', 'Return PASS/WARN/FAIL with prompt provenance notes.'].join('\n') }],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: {
        projectId: project.id,
        issueRef: '48',
        promptCommentUrls: ['https://github.com/edictum-ai/ductum/issues/48#issuecomment-1'],
      },
    })

    expect(result.response.status).toBe(201)
    expect(result.json).toMatchObject({
      recordType: 'GitHubIssueIntake',
      import: { disposition: 'created', mode: 'prompt-sections', reviewPrompt: { routedToTask: true, source: 'issue comment (https://github.com/edictum-ai/ductum/issues/48#issuecomment-1)' } },
      task: {
        verification: [],
        source: { promptImport: { mode: 'prompt-sections', implementation: { heading: 'Implementation Prompt', sourceKind: 'issue-body', sourceUrl: 'https://github.com/edictum-ai/ductum/issues/48' }, review: { heading: 'Review Prompt', sourceKind: 'issue-comment', commentUrl: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1' } } },
      },
    })
    const taskPrompt = (result.json as { task: { prompt: string } }).task.prompt
    expect(taskPrompt).toContain('## Implementation Prompt')
    expect(taskPrompt).toContain('Implement prompt import support.')
    expect(taskPrompt).not.toContain('Return PASS/WARN/FAIL with prompt provenance notes.')
  })

  it('returns the existing imported work when prompt material is unchanged', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
    vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    const fetchMock = stubIssueFetch({
      number: 48,
      title: 'factory: import prompts from issue',
      body: '## Execution Prompt\nShip prompt import support.',
      comments: [{ id: 1, html_url: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1', body: '## Review Prompt\nReview prompt import proof.' }],
    })
    vi.stubGlobal('fetch', fetchMock)

    const body = {
      projectId: project.id,
      issueRef: '48',
      promptCommentUrls: ['https://github.com/edictum-ai/ductum/issues/48#issuecomment-1'],
    }
    const first = await requestJson(fixture.app, '/api/issues/intake', { method: 'POST', body })
    const second = await requestJson(fixture.app, '/api/issues/intake', { method: 'POST', body })

    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(201)
    expect((first.json as { spec: { id: string } }).spec.id).toBe((second.json as { spec: { id: string } }).spec.id)
    expect((second.json as { import: { disposition: string } }).import.disposition).toBe('unchanged')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('fails loudly when prompt material changes after import', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
    vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/repos/edictum-ai/ductum/issues/48')) {
        return new Response(JSON.stringify({ number: 48, html_url: 'https://github.com/edictum-ai/ductum/issues/48', title: 'factory: import prompts from issue', body: '## Implementation Prompt\nImplement v2 prompt import support.', labels: [{ name: 'P1' }] }), { status: 200 })
      }
      if (url.endsWith('/repos/edictum-ai/ductum/issues/48/comments')) {
        const count = fetchMock.mock.calls.filter(([called]) => String(called).endsWith('/comments')).length
        return new Response(JSON.stringify([{ id: 1, html_url: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1', body: count === 1 ? '## Review Prompt\nReview v1.' : '## Review Prompt\nReview v2.' }]), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const body = {
      projectId: project.id,
      issueRef: '48',
      promptCommentUrls: ['https://github.com/edictum-ai/ductum/issues/48#issuecomment-1'],
    }
    const first = await requestJson(fixture.app, '/api/issues/intake', { method: 'POST', body })
    const second = await requestJson(fixture.app, '/api/issues/intake', { method: 'POST', body })

    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(400)
    expect(second.text).toContain('GitHub issue prompt import changed')
    expect(second.text).toContain('digest')
  })

  it('fails when explicit prompt import is missing a review prompt and ignores unselected prompt comments', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
    vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    vi.stubGlobal('fetch', stubIssueFetch({
      number: 48,
      title: 'factory: import prompts from issue',
      body: '## Execution Prompt\nImplement prompt import support.',
      comments: [{ id: 1, html_url: 'https://github.com/edictum-ai/ductum/issues/48#issuecomment-1', body: '## Review Prompt\nThis unselected comment must not become executable.' }],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', { method: 'POST', body: { projectId: project.id, issueRef: '48' } })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('missing a Review Prompt section')
  })

  it('fails when a selected prompt comment URL is not present on the issue', async () => {
    fixture = await createFixture()
    const { project } = seedBase(fixture)
    vi.stubEnv('DUCTUM_GITHUB_DEV_READ_MODE', 'pat')
    vi.stubEnv('DUCTUM_GITHUB_DEV_TOKEN', 'dev-read-token')
    fixture.repos.repositories.create({
      id: createId<'RepositoryId'>() as never,
      projectId: project.id,
      name: 'ductum',
      spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', localPath: '/repo/ductum' },
    })
    vi.stubGlobal('fetch', stubIssueFetch({
      number: 48,
      title: 'factory: import prompts from issue',
      body: '## Implementation Prompt\nImplement prompt import support.\n\n## Review Prompt\nReview prompt import support.',
      comments: [],
    }))

    const result = await requestJson(fixture.app, '/api/issues/intake', {
      method: 'POST',
      body: {
        projectId: project.id,
        issueRef: '48',
        promptCommentUrls: ['https://github.com/edictum-ai/ductum/issues/48#issuecomment-missing'],
      },
    })

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('selected comment was not found')
  })
})

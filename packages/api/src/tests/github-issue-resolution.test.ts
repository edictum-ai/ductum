import { createId, type Evidence, type Run } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeGitHubIssue } from '../lib/github-issue-resolution.js'
import { createFixture, type TestFixture } from './helpers.js'
import {
  findResolutionEvidence,
  setupDoneRunFixture,
} from './github-issue-resolution.helpers.js'
import { registerRouteTestCleanup } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

function bindFactoryDir(target: TestFixture, factoryDir: string) {
  target.context.factoryDataDir = factoryDir
}

describe('closeGitHubIssue — happy path writes through GitHub App auth', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates a closeout comment and PATCHes the issue to closed using GitHub App auth', async () => {
    fixture = await createFixture()
    const { run, factoryDir, headSha, mergeCommitSha, prNumber, prUrl } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        const body = JSON.parse(String(init?.body)) as { body: string }
        expect(body.body).toContain(`<!-- ductum:github-issue-resolution:${run.id} -->`)
        expect(body.body).toContain(`- Run: \`${run.id}\``)
        expect(body.body).toContain(`- PR: #${prNumber} ${prUrl}`)
        expect(body.body).toContain(`- Head SHA: \`${headSha}\``)
        expect(body.body).toContain(`- Merge commit: \`${mergeCommitSha}\``)
        expect(body.body).toContain('- Required checks source: branch_protection')
        expect(body.body).toContain('- Operator action: historical closeout')
        expect(body.body).toContain('- GitHub App actor: GitHub App 123 installation 456 (github_app)')
        return new Response(JSON.stringify({
          id: 202,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-202',
          body: body.body,
          user: { login: 'ductum-factory', type: 'Bot' },
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12')) {
        expect(init?.method).toBe('PATCH')
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer app-token' })
        const body = JSON.parse(String(init?.body)) as { state: string }
        expect(body.state).toBe('closed')
        return new Response(JSON.stringify({
          number: 12,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12',
          state: 'closed',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
      operatorAction: 'historical closeout',
    })

    expect(result.recordType).toBe('GitHubIssueCloseout')
    expect(result.issue).toMatchObject({
      number: 12,
      url: 'https://github.com/edictum-ai/ductum/issues/12',
      repository: 'edictum-ai/ductum',
    })
    expect(result.comment).toMatchObject({
      url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-202',
      id: 202,
    })
    expect(result.pr).toMatchObject({ number: prNumber, url: prUrl })
    expect(result.merge).toMatchObject({
      commitSha: mergeCommitSha,
      baseBranch: 'main',
      requiredChecksSource: 'branch_protection',
    })
    expect(result.actor).toMatchObject({
      type: 'github_app',
      label: 'GitHub App 123 installation 456',
    })
    expect(result.operatorAction).toBe('historical closeout')

    const evidence = findResolutionEvidence(run.id, fixture.repos.evidence.list(run.id))
    expect(evidence).toBeDefined()
    expect(evidence?.payload).toMatchObject({
      kind: 'github-issue-resolution',
      issueNumber: 12,
      issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
      commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-202',
      commentId: 202,
      prNumber,
      prUrl,
      runId: run.id,
      headSha,
      mergeCommitSha,
      requiredChecksSource: 'branch_protection',
      operatorAction: 'historical closeout',
      actorType: 'github_app',
      actorLabel: 'GitHub App 123 installation 456',
    })

    const orderedFetches = fetchMock.mock.calls.map(([url]) => String(url))
    const commentIndex = orderedFetches.findIndex((url) => url.endsWith('/issues/12/comments'))
    const closeIndex = orderedFetches.findIndex((url) => url.endsWith('/issues/12'))
    expect(commentIndex).toBeGreaterThanOrEqual(0)
    expect(closeIndex).toBeGreaterThan(commentIndex)
  })

  it('updates an existing closeout comment when called twice for the same issue', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-issue-resolution',
        repo: 'edictum-ai/ductum',
        issueNumber: 12,
        issueUrl: 'https://github.com/edictum-ai/ductum/issues/12',
        commentUrl: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-303',
        commentId: 303,
        prNumber: 81,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
        runId: run.id,
        headSha: 'abc123',
        mergeCommitSha: 'merge9876543210abcdef',
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
      },
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/issues/comments/303')) {
        expect(init?.method).toBe('PATCH')
        const body = JSON.parse(String(init?.body)) as { body: string }
        expect(body.body).toContain(`<!-- ductum:github-issue-resolution:${run.id} -->`)
        return new Response(JSON.stringify({
          id: 303,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-303',
          body: body.body,
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12')) {
        return new Response(JSON.stringify({
          number: 12,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12',
          state: 'closed',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })

    expect(result.comment.id).toBe(303)
    expect(result.comment.url).toBe('https://github.com/edictum-ai/ductum/issues/12#issuecomment-303')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/issues/comments/303'),
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/issues/12'),
      expect.objectContaining({ method: 'PATCH' }),
    )
  })
})

describe('closeGitHubIssue — non-issue-sourced work uses operator issueRef', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('closes a historical issue against a run whose task was never imported from the issue', async () => {
    fixture = await createFixture()
    const { run, factoryDir, headSha, mergeCommitSha, prNumber, prUrl } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
        return new Response(JSON.stringify({
          id: 404,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-404',
          body: '',
          user: { login: 'ductum-factory', type: 'Bot' },
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12')) {
        return new Response(JSON.stringify({
          number: 12,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12',
          state: 'closed',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: 'https://github.com/edictum-ai/ductum/issues/12',
      runId: run.id,
      operatorAction: 'retroactive close for shipped historical work',
    })

    expect(result.run.id).toBe(run.id)
    expect(result.pr).toMatchObject({ number: prNumber, url: prUrl })
    expect(result.merge.commitSha).toBe(mergeCommitSha)
    expect(result.merge.requiredChecksSource).toBe('branch_protection')
    expect((result.run as Run).commitSha).toBe(headSha)
    expect(result.operatorAction).toBe('retroactive close for shipped historical work')
  })
})

describe('closeGitHubIssue — evidence hygiene', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records resolution evidence with the operator action and actor label distinct', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
        return new Response(JSON.stringify({
          id: 505,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-505',
          body: '',
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12')) {
        return new Response(JSON.stringify({
          number: 12,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12',
          state: 'closed',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
      operatorAction: 'operator-approved: historical #243',
    })

    const evidence = fixture.repos.evidence.list(run.id) as Evidence[]
    const resolution = findResolutionEvidence(run.id, evidence)
    expect(resolution).toBeDefined()
    expect(resolution?.payload.operatorAction).toBe('operator-approved: historical #243')
    expect(resolution?.payload.actorType).toBe('github_app')
    expect(resolution?.payload.actorLabel).toBe('GitHub App 123 installation 456')
    expect(resolution?.payload).not.toHaveProperty('token')
  })
})

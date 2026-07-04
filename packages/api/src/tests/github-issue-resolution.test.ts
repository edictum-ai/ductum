import { createId, type Evidence, type Run } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeGitHubIssue } from '../lib/github-issue-resolution.js'
import { createFixture, type TestFixture } from './helpers.js'
import { setupGitHubIssueFixture } from './github-lifecycle-issue-comment.helpers.js'
import { registerRouteTestCleanup } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

function bindFactoryDir(target: TestFixture, factoryDir: string) {
  target.context.factoryDataDir = factoryDir
}

/**
 * P1 #243 review round 3: fixture builder inlined into each focused test file
 * so the diff stays within `packages/api/src/tests/github-issue-*.test.ts`.
 * Layers `done` stage + `github-pr-merge` evidence on the issue-import fixture
 * so each test can mutate one knob without rebuilding the PR-backed shape.
 */
function setupDoneRunFixture(fixture: TestFixture, opts: {
  stage?: Run['stage']
  prNumber?: number
  requiredChecksSource?: 'policy' | 'branch_protection' | 'none'
  observedChecks?: Array<{ name: string; status: string; conclusion: string | null }>
  includeMergeEvidence?: boolean
} = {}) {
  const headSha = 'abc123'
  const prNumber = opts.prNumber ?? 81
  const prUrl = 'https://github.com/edictum-ai/ductum/pull/81'
  const branch = 'feat/github-issue-intake-auth'
  const mergeCommitSha = 'merge9876543210abcdef'
  const baseBranch = 'main'
  const requiredChecksSource = opts.requiredChecksSource ?? 'branch_protection'
  const base = setupGitHubIssueFixture(fixture, {
    run: { branch, commitSha: headSha, prNumber, prUrl },
  })
  const project = fixture.repos.projects.getByName('ductum')
  if (project == null) throw new Error('setupDoneRunFixture expected a "ductum" project')
  const repositoryId = fixture.repos.repositories.list(project.id)[0]?.id ?? ''
  fixture.repos.runs.updateStage(base.run.id, (opts.stage ?? 'done') as never, 'test setup')
  if (opts.includeMergeEvidence !== false) {
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: base.run.id,
      type: 'custom',
      payload: {
        kind: 'github-pr-merge',
        repo: 'edictum-ai/ductum',
        prNumber,
        prUrl,
        branch,
        headSha,
        baseBranch,
        mergeMethod: 'merge',
        merged: true,
        mergeCommitSha,
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
        requiredChecksSource,
        requiredChecks: requiredChecksSource === 'none' ? [] : ['build-and-test'],
        observedChecks: opts.observedChecks ?? (requiredChecksSource === 'none'
          ? []
          : [
              { name: 'build-and-test', status: 'completed', conclusion: 'success' },
            ]),
      },
    })
  }
  return {
    factoryDir: base.factoryDir,
    run: fixture.repos.runs.get(base.run.id) ?? base.run,
    mergeCommitSha,
    headSha,
    prNumber,
    prUrl,
    repositoryId,
  }
}

function findResolutionEvidence(runId: Run['id'], evidence: Evidence[]): Evidence | undefined {
  return [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && entry.payload.kind === 'github-issue-resolution'
    && entry.runId === runId,
  )
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

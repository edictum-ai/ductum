import { createId, type Run } from '@ductum/core'
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
 * (see github-issue-resolution.test.ts for full rationale). Holds the
 * close-failure/retry dedup test split from github-issue-resolution-errors
 * so both files stay under the 300 LOC file-size gate after inlining.
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

describe('closeGitHubIssue — comment evidence dedups across close failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records comment-id evidence before the close call so a retry PATCHes the same comment', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    let closeAttempts = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
        return new Response(JSON.stringify({
          id: 606,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-606',
          body: '',
        }), { status: 200 })
      }
      if (url.endsWith('/issues/comments/606')) {
        return new Response(JSON.stringify({
          id: 606,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-606',
          body: '',
        }), { status: 200 })
      }
      if (url.endsWith('/issues/12')) {
        closeAttempts += 1
        if (closeAttempts === 1) {
          // First close call fails — comment was already created above.
          return new Response(JSON.stringify({ message: 'server boom' }), { status: 500 })
        }
        return new Response(JSON.stringify({
          number: 12,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12',
          state: 'closed',
        }), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    // First call: comment create succeeds, close fails. Caller sees the throw.
    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/GitHub request failed \(500\)/)

    // Pre-close comment evidence must exist even though close failed, so a
    // retry can dedup against it instead of duplicating the comment.
    const evidenceAfterFailure = fixture.repos.evidence.list(run.id)
    const commentEvidence = evidenceAfterFailure.find((entry) =>
      entry.type === 'custom'
      && entry.payload.kind === 'github-issue-resolution-comment'
      && entry.payload.issueNumber === 12)
    expect(commentEvidence).toBeDefined()
    expect(commentEvidence?.payload.commentId).toBe(606)
    // No full resolution evidence yet — close failed.
    const resolutionEvidence = evidenceAfterFailure.find((entry) =>
      entry.type === 'custom'
      && entry.payload.kind === 'github-issue-resolution')
    expect(resolutionEvidence).toBeUndefined()

    // Second call: must PATCH the existing comment, not POST a new one.
    const result = await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })

    expect(result.comment.id).toBe(606)

    const commentPosts = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith('/issues/12/comments') && init?.method !== 'PATCH').length
    const commentPatches = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/issues/comments/606')).length
    expect(commentPosts).toBe(1)
    expect(commentPatches).toBe(1)

    // After the successful retry, full resolution evidence exists.
    const evidenceAfterRetry = fixture.repos.evidence.list(run.id)
    const resolution = evidenceAfterRetry.find((entry) =>
      entry.type === 'custom'
      && entry.payload.kind === 'github-issue-resolution')
    expect(resolution).toBeDefined()
    expect(resolution?.payload.commentId).toBe(606)
  })
})

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
 * merge-evidence headSha proof split from github-issue-resolution-strict
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

describe('closeGitHubIssue — uses merge-evidence headSha, not run.commitSha', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('publishes the merge-evidence headSha even when run.commitSha has been mutated to the merge commit', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    // Simulate the post-merge state: the merge driver updates run.commitSha
    // to the merge commit. The closeout must still publish the original PR
    // head, taken from the merge evidence.
    fixture.repos.runs.updateGitArtifacts(run.id, {
      branch: 'feat/github-issue-intake-auth',
      commitSha: 'merge9876543210abcdef',
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/access_tokens')) {
        return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
      }
      if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
        const body = JSON.parse(String(init?.body)) as { body: string }
        // Head SHA line must carry the original PR head 'abc123', NOT the
        // merge commit 'merge9876543210abcdef'. The Merge commit line below
        // is the only legitimate place for that hash to appear.
        expect(body.body).toContain('- Head SHA: `abc123`')
        expect(body.body).not.toContain('- Head SHA: `merge9876543210abcdef`')
        return new Response(JSON.stringify({
          id: 707,
          html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-707',
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

    expect(result.run.commitSha).toBe('merge9876543210abcdef')
    // The closeout result + evidence use the original PR headSha.
    const evidence = fixture.repos.evidence.list(run.id)
    const resolution = evidence.find((entry) =>
      entry.type === 'custom' && entry.payload.kind === 'github-issue-resolution')
    expect(resolution?.payload.headSha).toBe('abc123')
    expect(resolution?.payload.mergeCommitSha).toBe('merge9876543210abcdef')
  })
})

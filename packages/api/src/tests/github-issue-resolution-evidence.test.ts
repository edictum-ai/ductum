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
 * (see github-issue-resolution.test.ts for full rationale). Split from that
 * file so both stay under the 300 LOC file-size gate after inlining.
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
    // P1 #243 review round 4: real check evidence is recorded, not just the
    // requiredChecksSource label.
    expect(resolution?.payload.requiredChecks).toEqual(['build-and-test'])
    expect(resolution?.payload.observedChecks).toEqual([
      { name: 'build-and-test', status: 'completed', conclusion: 'success' },
    ])
    expect(resolution?.payload).not.toHaveProperty('token')
  })
})

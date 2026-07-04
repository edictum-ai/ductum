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
 * P1 #243 review round 5: focused tests proving the close path fails closed
 * unless GitHub's PATCH issue response proves `state === "closed"`. The
 * orchestrator must not record `github-issue-resolution` evidence when the
 * close response state is open, missing, or unknown. Fixture builder inlined
 * from github-issue-resolution.test.ts so this file stays self-contained and
 * under the 300 LOC file-size gate.
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

/**
 * Build a fetch mock whose `/issues/12` PATCH response carries the supplied
 * `state` field. `undefined` omits the field entirely to test the missing
 * case; other values are sent through unchanged so we can probe malformed or
 * unknown literals.
 */
function buildFetchMock(stateValue: string | undefined) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/access_tokens')) {
      return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
    }
    if (url.endsWith('/issues/12/comments') && init?.method !== 'PATCH') {
      return new Response(JSON.stringify({
        id: 808,
        html_url: 'https://github.com/edictum-ai/ductum/issues/12#issuecomment-808',
        body: '',
      }), { status: 200 })
    }
    if (url.endsWith('/issues/12')) {
      const responseBody: Record<string, unknown> = {
        number: 12,
        html_url: 'https://github.com/edictum-ai/ductum/issues/12',
      }
      if (stateValue !== undefined) responseBody.state = stateValue
      return new Response(JSON.stringify(responseBody), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
  })
}

function findResolutionEvidence(runId: Run['id']) {
  const evidence = fixture?.repos.evidence.list(runId) ?? []
  return [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && entry.payload.kind === 'github-issue-resolution'
    && entry.runId === runId,
  )
}

describe('closeGitHubIssue — close PATCH response must prove state=closed', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fails closed when GitHub returns state="open" on the PATCH response', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    vi.stubGlobal('fetch', buildFetchMock('open'))

    // P1 #243 review round 5: a 200 with state="open" means GitHub did not
    // honor the close (e.g., issue was concurrently reopened). Must not
    // record full github-issue-resolution evidence.
    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/did not prove closed state/)

    expect(findResolutionEvidence(run.id)).toBeUndefined()
  })

  it('fails closed when the PATCH response state field is missing', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    vi.stubGlobal('fetch', buildFetchMock(undefined))

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/did not prove closed state/)

    expect(findResolutionEvidence(run.id)).toBeUndefined()
  })

  it('fails closed when the PATCH response state field is an unknown literal', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    vi.stubGlobal('fetch', buildFetchMock('purple'))

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/did not prove closed state/)

    expect(findResolutionEvidence(run.id)).toBeUndefined()
  })

  it('still closes when the PATCH response state is exactly "closed"', async () => {
    fixture = await createFixture()
    const { run, factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    vi.stubGlobal('fetch', buildFetchMock('closed'))

    const result = await closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })

    expect(result.recordType).toBe('GitHubIssueCloseout')
    expect(findResolutionEvidence(run.id)).toBeDefined()
  })
})

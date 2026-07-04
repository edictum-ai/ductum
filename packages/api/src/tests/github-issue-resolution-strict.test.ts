import { createId } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeGitHubIssue } from '../lib/github-issue-resolution.js'
import { createFixture, type TestFixture } from './helpers.js'
import { setupDoneRunFixture } from './github-issue-resolution.helpers.js'
import { registerRouteTestCleanup } from './routes/shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

function bindFactoryDir(target: TestFixture, factoryDir: string) {
  target.context.factoryDataDir = factoryDir
}

/**
 * P1 #243 review round 2: focused tests for the strict auth + merge-evidence
 * guarantees the closeout path must enforce. Split from
 * `github-issue-resolution-errors.test.ts` to keep both files under 300 LOC.
 */
describe('closeGitHubIssue — strict review round 2 guarantees', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects when requiredChecksSource is missing entirely', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    // Overwrite the merge evidence with one missing requiredChecksSource.
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-pr-merge',
        repo: 'edictum-ai/ductum',
        prNumber: 81,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
        headSha: 'abc123',
        baseBranch: 'main',
        mergeMethod: 'merge',
        merged: true,
        mergeCommitSha: 'merge9876543210abcdef',
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
      },
    })

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/lacks a required-check policy source/)
  })

  it('rejects when a required check is missing from observedChecks', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, {
      requiredChecksSource: 'branch_protection',
      observedChecks: [],
    })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/missing observed required check "build-and-test"/)
  })

  it('rejects when a required check concluded failure', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, {
      requiredChecksSource: 'branch_protection',
      observedChecks: [
        { name: 'build-and-test', status: 'completed', conclusion: 'failure' },
      ],
    })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/required check "build-and-test" concluded "failure"/)
  })

  it('rejects when a required check did not complete (in_progress)', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, {
      requiredChecksSource: 'branch_protection',
      observedChecks: [
        { name: 'build-and-test', status: 'in_progress', conclusion: null },
      ],
    })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/did not complete \(status="in_progress"\)/)
  })

  it('rejects when merge evidence prNumber does not match run.prNumber', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, {
      prNumber: 81,
    })
    bindFactoryDir(fixture, factoryDir)
    // Stale evidence pointing at a different PR.
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-pr-merge',
        repo: 'edictum-ai/ductum',
        prNumber: 999,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/999',
        headSha: 'abc123',
        baseBranch: 'main',
        mergeMethod: 'merge',
        merged: true,
        mergeCommitSha: 'merge9876543210abcdef',
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
        requiredChecksSource: 'branch_protection',
        requiredChecks: ['build-and-test'],
        observedChecks: [
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        ],
      },
    })

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/evidence prNumber 999 does not match run.prNumber 81/)
  })

  it('rejects when merge evidence repo does not match the resolved repository', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-pr-merge',
        repo: 'other-org/different-repo',
        prNumber: 81,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
        headSha: 'abc123',
        baseBranch: 'main',
        mergeMethod: 'merge',
        merged: true,
        mergeCommitSha: 'merge9876543210abcdef',
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
        requiredChecksSource: 'branch_protection',
        requiredChecks: ['build-and-test'],
        observedChecks: [
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        ],
      },
    })

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/evidence repo "other-org\/different-repo" does not match repository/)
  })

  it('fails closed even when DUCTUM_GITHUB_DEV_WRITE_MODE=pat is set in env', async () => {
    fixture = await createFixture()
    const { factoryDir, run, repositoryId } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    // Strip the GitHub App authRef so resolveGitHubAuth cannot succeed.
    const repository = fixture.repos.repositories.get(repositoryId as never)
    expect(repository).toBeDefined()
    const { authRef: _drop, ...specWithoutAuth } = repository!.spec
    fixture.repos.repositories.update(repositoryId as never, {
      spec: specWithoutAuth,
    })
    // Set the dev env vars that the standard resolver would fall back to.
    // The strict App-only resolver must NOT consult these.
    const previousEnv = {
      DUCTUM_GITHUB_DEV_WRITE_MODE: process.env.DUCTUM_GITHUB_DEV_WRITE_MODE,
      DUCTUM_GITHUB_DEV_TOKEN: process.env.DUCTUM_GITHUB_DEV_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    }
    process.env.DUCTUM_GITHUB_DEV_WRITE_MODE = 'pat'
    process.env.DUCTUM_GITHUB_DEV_TOKEN = 'ghp_fake_dev_token_for_test_only'
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN

    try {
      await expect(closeGitHubIssue(fixture.context, {
        projectName: 'ductum',
        issueRef: '12',
        runId: run.id,
      })).rejects.toThrow(/missing GitHub App installation auth/)
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) {
          delete process.env[key as keyof typeof previousEnv]
        } else {
          process.env[key as keyof typeof previousEnv] = value
        }
      }
    }
  })
})

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

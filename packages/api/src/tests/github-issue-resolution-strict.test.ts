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
 * P1 #243 review round 2/3: focused tests for the strict auth + merge-evidence
 * guarantees the closeout path must enforce. Review round 3 inlined the
 * fixture builder (see github-issue-resolution.test.ts for full rationale)
 * and split the headSha proof into github-issue-resolution-headsha.test.ts
 * so both files stay under the 300 LOC file-size gate.
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

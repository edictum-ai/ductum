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

describe('closeGitHubIssue — error paths fail closed', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects when the run is missing', async () => {
    fixture = await createFixture()
    const { factoryDir } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: 'run-does-not-exist',
    })).rejects.toThrow(/Run not found/)
  })

  it('rejects when the run is not done', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, { stage: 'ship' })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/issue closeout requires stage "done"/)
  })

  it('rejects when the run lacks PR metadata', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    fixture.repos.runs.updateGitArtifacts(run.id, {
      branch: null,
      commitSha: null,
      prNumber: null,
      prUrl: null,
    })

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/missing required PR metadata/)
  })

  it('rejects when the run lacks github-pr-merge evidence', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, { includeMergeEvidence: false })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/no GitHub PR merge evidence/)
  })

  it('rejects when merge evidence says merged=false', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: run.id,
      type: 'custom',
      payload: {
        kind: 'github-pr-merge',
        repo: 'edictum-ai/ductum',
        prNumber: 81,
        headSha: 'abc123',
        baseBranch: 'main',
        mergeMethod: 'merge',
        merged: false,
        mergeCommitSha: 'merge9876543210abcdef',
        actorType: 'github_app',
        actorLabel: 'GitHub App 123 installation 456',
        requiredChecksSource: 'branch_protection',
        requiredChecks: ['build-and-test'],
        observedChecks: [],
      },
    })

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/does not confirm a successful merge/)
  })

  it('rejects when requiredChecksSource is none and no CI/observed checks', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture, {
      requiredChecksSource: 'none',
      observedChecks: [],
    })
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/lacks a required-check policy source/)
  })

  it('fails closed without GitHub App installation auth (no gh/PAT fallback)', async () => {
    fixture = await createFixture()
    const { factoryDir, run, repositoryId } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    // Strip the GitHub App authRef so resolveGitHubAuth cannot fall back to gh/PAT.
    const repository = fixture.repos.repositories.get(repositoryId as never)
    expect(repository).toBeDefined()
    const { authRef: _drop, ...specWithoutAuth } = repository!.spec
    fixture.repos.repositories.update(repositoryId as never, {
      spec: specWithoutAuth,
    })
    // Make sure dev fallbacks cannot rescue the path even if env is set.
    const previousEnv = {
      DUCTUM_GITHUB_DEV_WRITE_MODE: process.env.DUCTUM_GITHUB_DEV_WRITE_MODE,
      GH_TOKEN: process.env.GH_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      DUCTUM_GITHUB_DEV_TOKEN: process.env.DUCTUM_GITHUB_DEV_TOKEN,
    }
    delete process.env.DUCTUM_GITHUB_DEV_WRITE_MODE
    delete process.env.GH_TOKEN
    delete process.env.GITHUB_TOKEN
    delete process.env.DUCTUM_GITHUB_DEV_TOKEN

    try {
      await expect(closeGitHubIssue(fixture.context, {
        projectName: 'ductum',
        issueRef: '12',
        runId: run.id,
      })).rejects.toThrow(/missing GitHub App installation auth/)
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) continue
        process.env[key as keyof typeof previousEnv] = value
      }
    }
  })

  it('rejects when the issue ref does not match the repository remote', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: 'other-org/different-repo#12',
      runId: run.id,
    })).rejects.toThrow(/does not match repository/)
  })

  it('rejects when the named repository does not exist', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      repository: 'missing',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/Repository not found in project ductum: missing/)
  })
})

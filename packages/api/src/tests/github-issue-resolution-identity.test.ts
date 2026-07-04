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
 * P1 #243 review round 4: focused tests proving closeout rejects merge
 * evidence that lacks the required repo/prNumber/prUrl identity fields.
 * Round 2 only cross-checked when present; round 4 makes them required so
 * stale or malformed PR evidence cannot close using run metadata alone.
 *
 * Fixture builder inlined from github-issue-resolution.test.ts so this file
 * stays self-contained and under the 300 LOC file-size gate.
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
 * Overwrite the latest github-pr-merge evidence with a malformed record
 * missing one of the required identity fields. Returns nothing; tests
 * assert that closeout throws.
 */
function appendMalformedMergeEvidence(
  fixture: TestFixture,
  runId: Run['id'],
  omit: 'repo' | 'prNumber' | 'prUrl',
) {
  const headSha = 'abc123'
  const baseBranch = 'main'
  const mergeCommitSha = 'merge9876543210abcdef'
  const basePayload: Record<string, unknown> = {
    kind: 'github-pr-merge',
    repo: 'edictum-ai/ductum',
    prNumber: 81,
    prUrl: 'https://github.com/edictum-ai/ductum/pull/81',
    branch: 'feat/github-issue-intake-auth',
    headSha,
    baseBranch,
    mergeMethod: 'merge',
    merged: true,
    mergeCommitSha,
    actorType: 'github_app',
    actorLabel: 'GitHub App 123 installation 456',
    requiredChecksSource: 'branch_protection',
    requiredChecks: ['build-and-test'],
    observedChecks: [
      { name: 'build-and-test', status: 'completed', conclusion: 'success' },
    ],
  }
  delete basePayload[omit]
  fixture.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: basePayload,
  })
}

describe('closeGitHubIssue — review round 4 merge-evidence identity guarantees', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('rejects when merge evidence is missing repo identity', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    appendMalformedMergeEvidence(fixture, run.id, 'repo')

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/missing required repo identity/)
  })

  it('rejects when merge evidence is missing prNumber identity', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    appendMalformedMergeEvidence(fixture, run.id, 'prNumber')

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/missing required prNumber identity/)
  })

  it('rejects when merge evidence is missing prUrl identity', async () => {
    fixture = await createFixture()
    const { factoryDir, run } = setupDoneRunFixture(fixture)
    bindFactoryDir(fixture, factoryDir)
    appendMalformedMergeEvidence(fixture, run.id, 'prUrl')

    await expect(closeGitHubIssue(fixture.context, {
      projectName: 'ductum',
      issueRef: '12',
      runId: run.id,
    })).rejects.toThrow(/missing required prUrl identity/)
  })
})

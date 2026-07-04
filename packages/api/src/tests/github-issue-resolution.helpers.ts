import { createId, type Evidence, type Run } from '@ductum/core'

import type { TestFixture } from './helpers.js'
import { setupGitHubIssueFixture } from './github-lifecycle-issue-comment.helpers.js'

/**
 * P1 #243: shared fixture builder for issue closeout tests. Layers
 * `done` stage + `github-pr-merge` evidence on top of the issue-import
 * fixture so each focused test can mutate one knob without rebuilding
 * the whole PR-backed completion shape from scratch.
 */
export interface SetupDoneRunOptions {
  stage?: Run['stage']
  branch?: string
  commitSha?: string
  prNumber?: number
  prUrl?: string
  mergeCommitSha?: string
  baseBranch?: string
  requiredChecksSource?: 'policy' | 'branch_protection' | 'none'
  observedChecks?: Array<{ name: string; status: string; conclusion: string | null }>
  includeMergeEvidence?: boolean
  includeCiEvidence?: boolean
}

export interface ResolvedDoneRunFixture {
  factoryDir: string
  run: Run
  mergeCommitSha: string
  headSha: string
  prNumber: number
  prUrl: string
  repositoryId: string
}

export function setupDoneRunFixture(
  fixture: TestFixture,
  options: SetupDoneRunOptions = {},
): ResolvedDoneRunFixture {
  const headSha = options.commitSha ?? 'abc123'
  const prNumber = options.prNumber ?? 81
  const prUrl = options.prUrl ?? 'https://github.com/edictum-ai/ductum/pull/81'
  const branch = options.branch ?? 'feat/github-issue-intake-auth'
  const mergeCommitSha = options.mergeCommitSha ?? 'merge9876543210abcdef'
  const baseBranch = options.baseBranch ?? 'main'
  const requiredChecksSource = options.requiredChecksSource ?? 'branch_protection'

  const base = setupGitHubIssueFixture(fixture, {
    run: { branch, commitSha: headSha, prNumber, prUrl },
  })
  const project = fixture.repos.projects.getByName('ductum')
  if (project == null) throw new Error('setupDoneRunFixture expected a "ductum" project')
  const repositories = fixture.repos.repositories.list(project.id)
  const repositoryId = repositories[0]?.id ?? ''

  const stage = options.stage ?? 'done'
  fixture.repos.runs.updateStage(base.run.id, stage as never, 'test setup')

  if (options.includeMergeEvidence !== false) {
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
        observedChecks: options.observedChecks ?? (requiredChecksSource === 'none'
          ? []
          : [
              { name: 'build-and-test', status: 'completed', conclusion: 'success' },
            ]),
      },
    })
  }

  if (options.includeCiEvidence === true) {
    fixture.repos.evidence.create({
      id: createId<'EvidenceId'>(),
      runId: base.run.id,
      type: 'ci',
      payload: {
        passed: true,
        commitSha: headSha,
        checks: [
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        ],
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

export function findResolutionEvidence(runId: Run['id'], evidence: Evidence[]): Evidence | undefined {
  return [...evidence].reverse().find((entry) =>
    entry.type === 'custom'
    && entry.payload.kind === 'github-issue-resolution'
    && entry.runId === runId,
  )
}

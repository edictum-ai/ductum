import type { Evidence, GitHubIssueSource, Run, Spec, Task } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import {
  buildConventionalPrTitle,
  buildGitHubIssueCompletionComment,
  buildGitHubPrBody,
} from '../lib/github-lifecycle-format.js'
import { buildRuntimeVerificationEvidencePayload } from '../lib/runtime-approval-evidence.js'
import { checkPublicGitMetadata, createId, type Repository } from '@ductum/core'
import { syncGitHubShipArtifacts } from '../lib/github-lifecycle.js'

const issueSource: GitHubIssueSource = {
  kind: 'github-issue',
  provider: 'github',
  repoOwner: 'edictum-ai',
  repoName: 'ductum',
  issueNumber: 276,
  issueUrl: 'https://github.com/edictum-ai/ductum/issues/276',
  title: 'Enforce public commit and PR metadata before approval',
  labels: ['bug', 'blocker:unattended', 'area:ci', 'priority:p0'],
  importedAt: '2026-07-05T15:45:00.000Z',
  formId: 'ductum-work-item',
  parsed: {
    workType: 'bug',
    priority: 'P0 - stops safe operation',
    area: 'ci',
    blockers: ['Blocks unattended operation', 'Blocks release'],
    objective: 'Block approval/ship when generated metadata is unsafe.',
    evidence: [],
    requirements: [
      'Enforce descriptive conventional subjects and titles',
      'Reject process/session/spec tokens and body injection',
      'Preserve legitimate tokens such as S3',
      'Render runtime verification evidence in PR bodies',
    ],
    outOfScope: ['Do not rewrite all commit generation'],
    acceptanceCriteria: [
      'Forbidden tokens fail before approval',
      'S3-style tokens preserved when meaningful',
      'PR bodies show runtime verification evidence when task verification is absent',
    ],
    verificationCommands: ['pnpm --filter @ductum/core test'],
    safetyNotes: ['No destructive commands'],
    suggestedBranch: 'fix/public-metadata-gate',
  },
}

function buildSpec(source: GitHubIssueSource): Spec {
  return { id: 'spec-276', projectId: 'project', name: source.title, status: 'approved', document: '# spec', source } as Spec
}

function buildTask(source: GitHubIssueSource, verification: string[] = []): Task {
  return {
    id: 'task-276',
    specId: 'spec-276',
    name: source.title,
    prompt: 'implement',
    repos: ['packages/core'],
    source,
    verification,
  } as Task
}

const run = { id: 'run-276' } as Run

function noCommandSnapshotEvidence(): Evidence[] {
  return [{
    id: 'evidence-worktree-snapshot',
    runId: run.id,
    type: 'custom',
    payload: { kind: 'worktree.snapshot', verifyOutput: { command: '(none)', exitCode: 0, tail: '(no verify commands configured)' } },
    createdAt: '2026-07-05T16:00:00.000Z',
  } as unknown as Evidence]
}

describe('GitHub lifecycle public-metadata gate integration', () => {
  describe('buildConventionalPrTitle drives the gate', () => {
    it('produces a gate-passing title for a descriptive product change', () => {
      const title = buildConventionalPrTitle(buildSpec(issueSource), buildTask(issueSource))
      expect(title).toBe('fix: Enforce public commit and PR metadata before approval')
      expect(checkPublicGitMetadata(title).ok).toBe(true)
    })

    it('preserves S3 in the generated title and passes the gate', () => {
      const s3Source: GitHubIssueSource = {
        ...issueSource,
        issueNumber: 280,
        title: 'Wire S3 multi-region replication',
        parsed: { ...issueSource.parsed, workType: 'feature', suggestedBranch: 'feat/s3-replication' },
      }
      const title = buildConventionalPrTitle(buildSpec(s3Source), buildTask(s3Source))
      expect(title).toBe('feat: Wire S3 multi-region replication')
      expect(checkPublicGitMetadata(title).ok).toBe(true)
    })
  })

  describe('runtime verification evidence fallback in PR bodies', () => {
    it('renders runtime verify commands when task.verification is empty', () => {
      // When a task carries no verification commands but the run recorded
      // runtime verify evidence (kind: 'verify' from
      // buildRuntimeVerificationEvidencePayload), the PR body must list
      // those commands and their states instead of the stale "No
      // verification commands recorded" placeholder.
      const task = buildTask(issueSource, /* verification */ [])
      const evidence: Evidence[] = [{
        id: 'evidence-runtime-verify',
        runId: run.id,
        type: 'custom',
        payload: buildRuntimeVerificationEvidencePayload(
          { commitSha: 'abc123' } as Run,
          {
            passed: true,
            output: '$ pnpm --filter @ductum/core test\n\n$ pnpm build',
            commands: [
              { command: 'pnpm --filter @ductum/core test', passed: true, output: '$ pnpm --filter @ductum/core test' },
              { command: 'pnpm build', passed: true, output: '$ pnpm build' },
            ],
          },
        ),
        createdAt: '2026-07-05T16:00:00.000Z',
      } as unknown as Evidence]

      const body = buildGitHubPrBody({ spec: buildSpec(issueSource), task, run, branch: 'fix/public-metadata-gate', evidence })

      expect(body).toContain('- pnpm --filter @ductum/core test (passed)')
      expect(body).toContain('- pnpm build (passed)')
      expect(body).not.toContain('No verification commands recorded')
    })

    it('falls back to the placeholder only when both task and runtime evidence are empty', () => {
      const task = buildTask(issueSource, [])
      const body = buildGitHubPrBody({ spec: buildSpec(issueSource), task, run, branch: 'fix/public-metadata-gate', evidence: [] })
      expect(body).toContain('No verification commands recorded')
    })

    it('ignores no-command worktree snapshots before using runtime commands', () => {
      const task = buildTask(issueSource, [])
      const evidence = noCommandSnapshotEvidence()

      const body = buildGitHubPrBody({ spec: buildSpec(issueSource), task, run, branch: 'fix/public-metadata-gate', evidence })

      expect(body).toContain('No verification commands recorded')
      expect(body).not.toContain('- (none) (passed)')
    })

    it('does not publish the run id in generated PR bodies', () => {
      const task = buildTask(issueSource, [])
      const body = buildGitHubPrBody({ spec: buildSpec(issueSource), task, run, branch: 'fix/public-metadata-gate', evidence: [] })
      const title = buildConventionalPrTitle(buildSpec(issueSource), task)

      expect(body).not.toContain(run.id)
      expect(body).not.toMatch(/^\s*-\s*Attempt:/m)
      expect(checkPublicGitMetadata(title, body).ok).toBe(true)
    })

    it('still prefers task.verification commands when both sources exist', () => {
      const task = buildTask(issueSource, ['pnpm --filter @ductum/api test'])
      const evidence: Evidence[] = [{
        id: 'evidence-runtime-verify',
        runId: run.id,
        type: 'custom',
        payload: buildRuntimeVerificationEvidencePayload(
          { commitSha: 'abc123' } as Run,
          { passed: true, output: '', commands: [{ command: 'pnpm --filter @ductum/api test', passed: true, output: '' }] },
        ),
        createdAt: '2026-07-05T16:00:00.000Z',
      } as unknown as Evidence]

      const body = buildGitHubPrBody({ spec: buildSpec(issueSource), task, run, branch: 'fix/public-metadata-gate', evidence })

      expect(body).toContain('- pnpm --filter @ductum/api test (passed)')
    })

    it('issue completion comment also surfaces runtime verify commands when task is empty', () => {
      const task = buildTask(issueSource, [])
      const evidence: Evidence[] = [{
        id: 'evidence-runtime-verify',
        runId: run.id,
        type: 'custom',
        payload: buildRuntimeVerificationEvidencePayload(
          { commitSha: 'abc123' } as Run,
          { passed: true, output: '', commands: [{ command: 'pnpm --filter @ductum/core test', passed: true, output: '' }] },
        ),
        createdAt: '2026-07-05T16:00:00.000Z',
      } as unknown as Evidence]

      const comment = buildGitHubIssueCompletionComment({
        spec: buildSpec(issueSource),
        task,
        run,
        branch: 'fix/public-metadata-gate',
        commitSha: 'abc123',
        prNumber: 277,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/277',
        evidence,
      })

      expect(comment).toContain('- Verification: pnpm --filter @ductum/core test (passed)')
      expect(comment).not.toContain('No verification commands recorded')
    })

    it('issue completion comment also ignores no-command worktree snapshots', () => {
      const task = buildTask(issueSource, [])
      const evidence = noCommandSnapshotEvidence()

      const comment = buildGitHubIssueCompletionComment({
        spec: buildSpec(issueSource),
        task,
        run,
        branch: 'fix/public-metadata-gate',
        commitSha: 'abc123',
        prNumber: 277,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/277',
        evidence,
      })

      expect(comment).toContain('No verification commands recorded')
      expect(comment).not.toContain('- Verification: (none) (passed)')
    })
  })

  describe('syncGitHubShipArtifacts fails closed before any GitHub write', () => {
    function buildMinimalContext(opts: { taskName: string; taskVerification?: string[] }): {
      context: Parameters<typeof syncGitHubShipArtifacts>[0]
      runId: string
      runGit: ReturnType<typeof vi.fn>
    } {
      const taskId = createId<'TaskId'>()
      const runId = createId<'RunId'>()
      const spec: Spec = { id: 'spec-min', projectId: 'project', name: 'spec', status: 'approved', document: '# spec' } as Spec
      const task: Task = {
        id: taskId,
        specId: spec.id,
        name: opts.taskName,
        prompt: 'implement',
        repos: ['packages/core'],
        verification: opts.taskVerification ?? [],
        repositoryId: 'repo-min',
      } as Task
      const run: Run = { id: runId, taskId, worktreePaths: ['/tmp/worktree'] } as Run
      const repository: Repository = {
        id: 'repo-min',
        projectId: 'project',
        name: 'ductum',
        spec: { remoteUrl: 'https://github.com/edictum-ai/ductum.git', defaultBranch: 'main' },
      } as Repository

      const runGit = vi.fn(async () => ({ stdout: 'deadbeef\n' }))
      // The repos mock only needs the methods syncGitHubShipArtifacts
      // touches before the gate runs (runs/tasks/specs/repositories/
      // evidence.get-by-runId). Cast through unknown so the partial mock
      // satisfies the SqliteRepo-shaped contract without pulling a real
      // DB into this unit test.
      const context = {
        repos: {
          runs: { get: () => run, updateGitArtifacts: () => run, list: () => [run] },
          tasks: { get: () => task },
          specs: { get: () => spec },
          repositories: { get: () => repository },
          secrets: { get: () => null, list: () => [] },
          evidence: { list: () => [], create: () => undefined },
        },
        factoryDataDir: '/tmp',
        now: () => new Date('2026-07-05T16:00:00.000Z'),
        runGit,
      } as unknown as Parameters<typeof syncGitHubShipArtifacts>[0]
      return { context, runId, runGit }
    }

    it('throws PublicGitMetadataError before any git or GitHub call when the title is a placeholder', async () => {
      // sanitizeGeneratedGitTitle('P3') === 'task' → produced title is
      // `feat: task`, which the gate rejects as a synthetic placeholder.
      const { context, runId, runGit } = buildMinimalContext({ taskName: 'P3' })
      await expect(syncGitHubShipArtifacts(context, runId as never)).rejects.toThrow(/public git metadata failed gate/)
      // The gate must run BEFORE any git or GitHub write attempt.
      expect(runGit).not.toHaveBeenCalled()
    })

    it('throws when the would-be description contains a forbidden stage label', async () => {
      // Use a task name where S6 appears mid-text so the sanitizer does
      // not strip it; the gate then rejects the residual stage label.
      const { context, runId, runGit } = buildMinimalContext({ taskName: 'Wire S6 lifecycle forward' })
      await expect(syncGitHubShipArtifacts(context, runId as never)).rejects.toThrow(/stage label S6/)
      expect(runGit).not.toHaveBeenCalled()
    })

    it('does NOT throw on the gate when the title preserves S3 as a legitimate domain token', async () => {
      // The pipeline will eventually fail at GitHub auth resolution (no
      // real secrets), but the gate must NOT be the failure reason.
      const { context, runId, runGit } = buildMinimalContext({ taskName: 'Wire S3 multi-region replication' })
      await expect(syncGitHubShipArtifacts(context, runId as never)).rejects.not.toThrow(/public git metadata failed gate/)
      expect(runGit).toHaveBeenCalled()
    })
  })
})

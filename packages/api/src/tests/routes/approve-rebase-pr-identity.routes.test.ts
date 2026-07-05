/**
 * Dogfood PR #271 regression: `approve --rebase` on a PR-backed run must keep
 * `run.branch` pinned to the recorded PR head branch even when the preserved
 * worktree is checked out on a local `ductum/github-lifecycle-*` branch.
 *
 * Live failure (PR #271, 2026-07-05):
 *
 *   ductum approve vpEO-uW0RtHA --rebase
 *   PR-backed merge rejected for run vpEO-uW0RtHA: PR head branch
 *   "feat/p1-approvals-empty-states" does not match recorded branch
 *   "ductum/github-lifecycle-vpEO-uW0"
 *
 * Root cause: `approveRunWithRebase` called `syncRunGitArtifacts`
 * unconditionally. For PR-backed runs the worktree is often on a local
 * `ductum/github-lifecycle-*` branch (the agent's checkout), and the sync
 * overwrote `run.branch` with that local branch. The merge path's
 * `assertPullRequestStateMatchesRun` then compared the live PR head branch
 * against the recorded lifecycle branch and failed closed.
 *
 * The merge path itself (`mergeApprovedRun`) already skips the sync for
 * PR-backed runs. This test pins the equivalent behavior in approve-rebase:
 * sync only the rebased `commitSha`; preserve `run.branch` as PR identity
 * evidence. The recorded `commitSha` advances to the rebased head that
 * approve-rebase verified and would have handed off to the merge path.
 */
import {
  createFixture,
  createId,
  describe,
  execFileAsync,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  setupMergeFixture,
  writeFile,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - approve --rebase PR identity preservation (dogfood PR #271)', () => {
  it('preserves PR head branch evidence when the worktree is on a local lifecycle branch', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      // Capture the original PR head SHA from feature/x.
      const { stdout: originalHeadOut } = await execFileAsync(
        'git',
        ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'],
      )
      const originalHead = originalHeadOut.trim()

      // Mirror the dogfood scenario: the agent's worktree was pushed to the
      // PR head branch (feat/...) through GitHub App, but locally it remained
      // checked out on `ductum/github-lifecycle-*`. Switch the worktree to
      // such a local lifecycle branch — HEAD stays at originalHead so the
      // assertPrBackedWorktreeMatchesRecordedHead guard still passes.
      const lifecycleBranch = 'ductum/github-lifecycle-test-run'
      await execFileAsync(
        'git',
        ['-C', mergeFix.worktree, 'checkout', '-B', lifecycleBranch],
      )

      // Advance main so rebase is required; the rebased commit will differ
      // from originalHead.
      await writeFile(`${mergeFix.upstream}/README.md`, '# initial\nmain moved\n')
      await execFileAsync('git', ['-C', mergeFix.upstream, 'add', 'README.md'])
      await execFileAsync('git', ['-C', mergeFix.upstream, 'commit', '-m', 'main moved'])

      fixture = await createFixture()
      const { project, spec, builder } = seedBase(fixture)
      const repository = fixture.repos.repositories.create({
        id: createId<'RepositoryId'>(),
        projectId: project.id,
        name: 'ductum-next',
        spec: { localPath: mergeFix.upstream },
      })
      const task = fixture.repos.tasks.create({
        id: createId<'TaskId'>(),
        specId: spec.id,
        repositoryId: repository.id,
        name: 'PR-backed approve-rebase lifecycle branch',
        prompt: 'repair',
        repos: [mergeFix.upstream],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      const run = fixture.repos.runs.create({
        id: createId<'RunId'>(),
        taskId: task.id,
        agentId: builder.id,
        parentRunId: null,
        stage: 'ship',
        terminalState: null,
        resetCount: 0,
        completedStages: ['understand', 'implement'],
        blockedReason: null,
        pendingApproval: true,
        sessionId: null,
        // PR identity evidence: the recorded branch is the PR head branch
        // (feat/...). The worktree is on `ductum/github-lifecycle-*`.
        branch: 'feature/x',
        commitSha: originalHead,
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        worktreePaths: [mergeFix.worktree],
        ciStatus: null,
        reviewStatus: 'pass',
        failReason: null,
        recoverable: true,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        lastHeartbeat: new Date().toISOString(),
        heartbeatTimeoutSeconds: 120,
      })

      const result = await requestJson(fixture.app, `/api/runs/${run.id}/approve-rebase`, {
        method: 'POST',
        body: {},
      })

      // The merge itself fails (no GitHub App auth in this fixture), but the
      // test still asserts the recorded artifacts AFTER rebase+sync. The bug
      // was that syncRunGitArtifacts overwrote run.branch with the local
      // lifecycle branch before the merge path ran.
      expect(result.json).toMatchObject({ success: false })

      // Read the rebased commit from the worktree to compare against records.
      const { stdout: rebasedOut } = await execFileAsync(
        'git',
        ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'],
      )
      const rebasedSha = rebasedOut.trim()

      const after = fixture.repos.runs.get(run.id) as Run
      // Criterion 1: recorded branch stays as the PR head branch evidence.
      // Under the bug, syncRunGitArtifacts overwrote this to
      // `ductum/github-lifecycle-test-run`, reproducing the dogfood mismatch.
      expect(after.branch).toBe('feature/x')
      expect(after.branch).not.toBe(lifecycleBranch)
      // Criterion 2: recorded commit SHA advances to the rebased head, the
      // commit approve-rebase verified and would have used for merge.
      expect(after.commitSha).toBe(rebasedSha)
      expect(after.commitSha).not.toBe(originalHead)

      // The PR-backed approve-rebase evidence row records both pre and post
      // commits and confirms verify passed.
      const rebaseEvidence = fixture.repos.evidence.list(run.id)
        .find((e) => {
          const payload = e.payload as Record<string, unknown> | null
          return payload != null && payload.kind === 'approval-rebase'
        })
      expect(rebaseEvidence).toBeDefined()
      expect(rebaseEvidence?.payload).toMatchObject({
        kind: 'approval-rebase',
        preCommit: originalHead,
        postCommit: rebasedSha,
        rebaseNeeded: true,
        verifyPassed: true,
      })
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

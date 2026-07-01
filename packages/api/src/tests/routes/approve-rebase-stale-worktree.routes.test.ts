/**
 * Issue #225 regression: `approve --rebase` must not silently trust a stale
 * preserved worktree over a PR-backed run's recorded head.
 *
 * Live failure (PR #224, 2026-07-01): `ductum approve pc6mDqj5tffq --rebase`
 * rebased the stale local worktree (commit 34625f58), ran `syncRunGitArtifacts`
 * which overwrote the recorded current PR head (27925b29), recorded
 * `approval-rebase` evidence with `rebaseNeeded: false`, and then failed. The
 * recorded head was mutated to the stale commit before the failure surfaced.
 *
 * This test pins the fix: a PR-backed run whose preserved worktree head does
 * not match the recorded PR head is refused FAST with a structured 400 before
 * any runUpdate, evidence, or commitSha mutation.
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
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => {
  fixture = undefined
})

describe('API routes - approve --rebase stale worktree guard (issue #225)', () => {
  it('refuses approve --rebase for a PR-backed run whose preserved worktree is stale', async () => {
    const mergeFix = await setupMergeFixture()
    try {
      const { stdout: staleOut } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
      const staleCommit = staleOut.trim()

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
        name: 'stale worktree rebase',
        prompt: 'repair',
        repos: [mergeFix.upstream],
        assignedAgentId: builder.id,
        status: 'active',
        verification: [],
      })
      // PR-backed run: recorded head is the current PR head; the preserved
      // worktree is still checked out at the older local commit.
      const currentPrHead = 'e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0'
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
        branch: 'feature/pr-current',
        commitSha: currentPrHead,
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

      // Must fail FAST with a structured 400, before any side effects.
      expect(result.response.status).toBe(400)
      expect(result.text).toContain('approve --rebase refused')
      expect(result.text).toContain('recorded PR head')
      expect(result.text).toContain(staleCommit.slice(0, 12))

      // No runUpdate row was written (the bug wrote
      // "operator triggered approve --rebase onto …" before failing).
      const updates = fixture.repos.runUpdates.list(run.id).map((u) => u.message)
      expect(updates).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/operator triggered approve --rebase/)]),
      )

      // No evidence row was written.
      const evidenceRows = fixture.repos.evidence.list(run.id)
      const approvalRebaseEvidence = evidenceRows.filter((e) => {
        const payload = e.payload as Record<string, unknown> | null
        return payload != null && payload.kind === 'approval-rebase'
      })
      expect(approvalRebaseEvidence).toHaveLength(0)

      // The recorded PR head was NOT overwritten with the stale worktree commit.
      const after = fixture.repos.runs.get(run.id) as Run
      expect(after.commitSha).toBe(currentPrHead)
      expect(after.commitSha).not.toBe(staleCommit)
      expect(after.pendingApproval).toBe(true)
      expect(after.terminalState).toBeNull()
    } finally {
      await mergeFix.cleanup()
    }
  }, 60_000)
})

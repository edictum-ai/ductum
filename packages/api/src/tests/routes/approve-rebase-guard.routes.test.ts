/**
 * Decision 122 (P3.2) — guard regression test (round-2 review fix).
 *
 * The original `approveRunWithRebase` guard was logically inverted:
 *
 *   if (!run.pendingApproval && run.terminalState == null) throw …
 *
 * which only threw when BOTH conditions held. A terminal run
 * (terminalState != null) silently bypassed the guard, ran a
 * `runUpdate` log entry, rebased the worktree on disk, wrote an
 * `approval-rebase` evidence row, and called `syncRunGitArtifacts`
 * (which can overwrite the recorded commit SHA on a terminal run)
 * before `approveRun` finally threw at its own guard.
 *
 * The fix replaces the single inverted condition with two separate
 * checks mirroring `approveRun` (approval.ts:28/31). This test pins
 * the regression: a terminal run hitting the rebase endpoint must
 * fail FAST, before any side effects, with a structured 400 message.
 */
import {
  createFixture,
  createId,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type Run,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - approve --rebase guard (round 2 review)', () => {
  it('rejects a terminal run BEFORE any side effects (no runUpdate, no evidence)', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'ship',
      // The bug was that this branch (terminalState != null) bypassed
      // the guard. Pin it.
      terminalState: 'failed',
      resetCount: 0,
      completedStages: ['understand', 'implement'],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feature/terminal',
      commitSha: 'abc1234567890def',
      prNumber: null,
      prUrl: null,
      worktreePaths: ['/tmp/should-never-be-touched'],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'orphaned by reconcile',
      recoverable: false,
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

    // Must return a 400 ValidationError, not 200 with a partial result.
    expect(result.response.status).toBe(400)
    expect(result.text).toContain('failed')
    expect(result.text).toContain('cannot approve-rebase a terminal run')

    // No runUpdate row was written (the bug wrote
    // "operator triggered approve --rebase onto …" before throwing).
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

    // The terminal run's recorded commit SHA was not overwritten.
    const after = fixture.repos.runs.get(run.id) as Run
    expect(after.commitSha).toBe('abc1234567890def')
    expect(after.terminalState).toBe('failed')
  })

  it('rejects a non-terminal run that is not pending approval', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'feature/in-progress',
      commitSha: null,
      prNumber: null,
      prUrl: null,
      worktreePaths: null,
      ciStatus: null,
      reviewStatus: null,
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

    expect(result.response.status).toBe(400)
    expect(result.text).toContain('not in a state that needs approval')

    const updates = fixture.repos.runUpdates.list(run.id).map((u) => u.message)
    expect(updates).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/operator triggered approve --rebase/)]),
    )
  })
})

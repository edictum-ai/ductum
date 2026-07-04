import { createFixture, describe, expect, it } from './shared.js'
import type { WorkflowState } from '@edictum/core'

/**
 * P2 #243 regression: PR-backed ship runs must not be promoted to `done`
 * by workflow sync. Ductum owns the external PR merge latch — when the
 * generic workflow runtime believes ship is complete and the run has a
 * PR reference (`prNumber` or `prUrl`), the DB must stay at
 * `ship + pendingApproval=true` so `ductum approve` remains the only
 * path that records final merge evidence and clears approval for
 * PR-backed work.
 *
 * P3 #243 widened the predicate from "full PR-backed metadata" (branch +
 * commitSha + prNumber + prUrl) to "any PR reference" (prNumber OR
 * prUrl). Missing expected-head metadata is itself a not-done signal;
 * the clamp must hold until the operator path records final evidence.
 *
 * Live symptom: `sjInS-gw16X9` (prNumber 262, branch, commitSha, prUrl)
 * reached `stage: done`, `pendingApproval: false` while PR #262 was
 * still open and green; `ductum approve` then failed with "Run does
 * not require approval".
 */
describe('EnforcementManager approval-required clamp (#243)', () => {
  it('clamps a full-PR-metadata ship run at ship + pendingApproval=true when the workflow runtime reports done', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')
    expect(fixture.context.runRepo.get(fixture.run.id)?.pendingApproval).toBe(true)

    // Record the PR-backed ship metadata exactly the way the GitHub
    // lifecycle path does after `onReadyToShip` — branch, commitSha,
    // prNumber, and prUrl are all present.
    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, {
      branch: 'feature/p2-ship-clamp',
      commitSha: 'abc123def456',
      prNumber: 262,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/262',
    })

    // Simulate the workflow runtime believing ship is complete (e.g.
    // because completedStages already includes ship after a parallel
    // recordApproval path). Without the clamp this would advance the
    // DB to `done` and clear pendingApproval.
    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const originalState = runtime.state.bind(runtime)
    runtime.state = async (...args): Promise<WorkflowState> => {
      const original = await originalState(...args)
      return { ...original, activeStage: 'done' }
    }

    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(true)
  })

  it('clamps a ship run with prNumber only (missing prUrl) when the workflow runtime reports done', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')
    expect(fixture.context.runRepo.get(fixture.run.id)?.pendingApproval).toBe(true)

    // Ductum has a PR number but no URL yet. The previous
    // full-metadata predicate would not clamp this; P3 #243 must.
    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, {
      branch: 'feature/p3-pr-only',
      commitSha: 'abc123def456',
      prNumber: 263,
      prUrl: null,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const originalState = runtime.state.bind(runtime)
    runtime.state = async (...args): Promise<WorkflowState> => {
      const original = await originalState(...args)
      return { ...original, activeStage: 'done' }
    }

    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(true)
  })

  it('clamps a ship run with prUrl only (missing prNumber) when the workflow runtime reports done', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')
    expect(fixture.context.runRepo.get(fixture.run.id)?.pendingApproval).toBe(true)

    // Ductum has a PR URL but no number yet. The previous
    // full-metadata predicate would not clamp this; P3 #243 must.
    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, {
      branch: 'feature/p3-url-only',
      commitSha: 'abc123def456',
      prNumber: null,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/264',
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const originalState = runtime.state.bind(runtime)
    runtime.state = async (...args): Promise<WorkflowState> => {
      const original = await originalState(...args)
      return { ...original, activeStage: 'done' }
    }

    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(true)
  })

  it('does not clamp a non-PR ship run when the workflow runtime reports done', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')

    // No PR reference — a local-only ship run. The clamp must not
    // engage; otherwise non-PR runs would be stuck forever.
    const runBefore = fixture.context.runRepo.get(fixture.run.id)
    expect(runBefore?.branch).toBeNull()
    expect(runBefore?.prNumber).toBeNull()
    expect(runBefore?.prUrl).toBeNull()

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const originalState = runtime.state.bind(runtime)
    runtime.state = async (...args): Promise<WorkflowState> => {
      const original = await originalState(...args)
      return { ...original, activeStage: 'done' }
    }

    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('done')
  })

  it('does not clamp when activeStage is still ship', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')

    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, {
      branch: 'feature/p2-ship-clamp',
      commitSha: 'abc123def456',
      prNumber: 262,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/262',
    })

    // No state override — runtime still reports ship. The clamp must
    // not engage on a routine refresh.
    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(true)
  })
})

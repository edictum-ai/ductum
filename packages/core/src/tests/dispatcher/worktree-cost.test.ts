import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
import { DEFAULT_ATTEMPT_RESOURCE_CEILINGS, defaultMaxInputTokensPerTurnForModel } from '../../attempt-resource-ceilings.js'
describe('Dispatcher - worktree locks and cost', () => {
  // ---------------------------------------------------------------------------
  // Worktree concurrency locks (P20)
  //
  // A fix or review run for branch X must not start while another live session
  // already owns the same lineage root. The lineage check uses the in-memory
  // activeSessions map so it is structural, not advisory.
  // ---------------------------------------------------------------------------
  describe('worktree concurrency locks (P20)', () => {
    it('blocks a review task (reviewer free) when the impl session is still live', async () => {
      // Key scenario: the builder is busy with impl-P1, but the reviewer agent
      // is completely free. Without the lineage lock, review-P1 would dispatch
      // to the reviewer immediately. With the lock, it must stay queued.
      const fixture = createFixture()

      // Dispatch impl-P1 → builder session is now live.
      createTask(fixture, { name: 'P1' })
      await fixture.dispatcher.cycle()
      expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledOnce()

      // Create the review task. The reviewer agent is free; without the lock
      // it would dispatch.
      const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

      // Second cycle: reviewer is free but lineage P1 is still live → no dispatch.
      const result = await fixture.dispatcher.cycle()
      expect(result.tasksDispatched).not.toContain(reviewTask.id)
      expect(fixture.context.taskRepo.get(reviewTask.id)?.status).toBe('ready')
      // Reviewer spawn must NOT have been called.
      expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
    })

    it('blocks a fix task whose lineage is contested by a live review session', async () => {
      // review-P1 is live (reviewer busy). fix-P1-r1 must not start even if
      // the builder is free, because they share the same worktree branch.
      const fixture = createFixture()

      // Dispatch a review task first.
      createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      await fixture.dispatcher.cycle()
      expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalledOnce()

      // Create fix-P1-r1 (builder role). Builder is free.
      const fixTask = createTask(fixture, { name: 'fix-P1-r1', requiredRole: 'builder' })

      // Cycle: builder free, but lineage P1 is live → no dispatch.
      const result = await fixture.dispatcher.cycle()
      expect(result.tasksDispatched).not.toContain(fixTask.id)
      expect(fixture.context.taskRepo.get(fixTask.id)?.status).toBe('ready')
      expect(fixture.context.taskDispatchSkipRepo.get(fixTask.id)).toMatchObject({
        reason: 'worktree-contention',
        detail: 'worktree held by an in-flight run',
      })

      await fixture.dispatcher.cycle()
      expect(fixture.context.taskDispatchSkipRepo.list().filter((skip) => skip.taskId === fixTask.id)).toHaveLength(1)
    })

    it('does not block tasks in a different lineage', async () => {
      // impl-P1 is live (builder busy). A review task for a different lineage
      // P2 must not be blocked by the P1 lock.
      const fixture = createFixture()

      // Dispatch impl-P1 → builder session live.
      createTask(fixture, { name: 'P1' })
      await fixture.dispatcher.cycle()

      // review-P2 — different originalName, reviewer is free.
      const reviewP2 = createTask(fixture, { name: 'review-P2', requiredRole: 'reviewer' })
      const result = await fixture.dispatcher.cycle()
      expect(result.tasksDispatched).toContain(reviewP2.id)
    })

    it('allows review dispatch once the contested impl session ends', async () => {
      // review-P1 must stay queued while impl-P1 is live, then dispatch
      // in the next cycle once the session ends.
      const fixture = createFixture()
      createTask(fixture, { name: 'P1' })
      await fixture.dispatcher.cycle()
      const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })

      // Still live — review is queued.
      const blockedResult = await fixture.dispatcher.cycle()
      expect(blockedResult.tasksDispatched).not.toContain(reviewTask.id)

      // End the impl session.
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
      await flush()

      // Session gone → review dispatches.
      const freedResult = await fixture.dispatcher.cycle()
      expect(freedResult.tasksDispatched).toContain(reviewTask.id)
    })

    it('allows independent impl tasks to dispatch in parallel regardless of other lineages', async () => {
      // impl-P1 is live (builder busy). impl-P2 is a fresh lineage → no
      // lineage contention. impl tasks never contest each other's worktrees.
      // In practice here the builder is busy, so impl-P2 queues on agent
      // availability — but that is the agent-busy check, not the lineage lock.
      // The lock must NOT independently prevent it.
      const fixture = createFixture()
      createTask(fixture, { name: 'P1' })
      await fixture.dispatcher.cycle()

      // impl-P2 (needs builder, which is busy) — blocked by agent-busy, not lineage.
      const implP2 = createTask(fixture, { name: 'P2' })
      const result = await fixture.dispatcher.cycle()

      // The lock did NOT mark it as an error — it's silently queued.
      expect(result.errors.map((e) => e.taskId)).not.toContain(implP2.id)
    })

    it('path-collision guard blocks dispatch when the same worktree path is already active', async () => {
      // Even when lineage names differ, two runs competing for the same
      // filesystem path must not run concurrently. Seed an impl run with a
      // worktree and an active session; then create a review whose lineage
      // resolver would reuse that same path. The path collision guard must
      // block the review.
      const fixture = createFixture()

      // Build an impl run WITH an active session (dispatch it via cycle).
      const implTask = createTask(fixture, { name: 'P1' })
      await fixture.dispatcher.cycle()
      const implRun = fixture.context.runRepo.list(implTask.id)[0]!
      // Give the impl run a worktree path so the path collision check fires.
      fixture.context.runRepo.updateWorktreePaths(implRun.id, ['/shared/wt'])

      // A review for P1 will resolve reuseWorktreeFromRunId → implRun, which
      // has worktreePaths ['/shared/wt']. The impl session is still live.
      const reviewTask = createTask(fixture, { name: 'review-P1', requiredRole: 'reviewer' })
      const result = await fixture.dispatcher.cycle()
      // Blocked by lineage (P1 is live) AND by the path collision guard.
      expect(result.tasksDispatched).not.toContain(reviewTask.id)
      expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
    })
  })

  describe('cost computation (P5)', () => {
    it('computes cost from the agent model when the harness reports 0', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      // Simulate Codex semantics: significant tokens, reported cost 0.
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 1_000_000,
        tokensOut: 100_000,
        costUsd: 0,
      })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]
      expect(run?.tokensIn).toBe(1_000_000)
      expect(run?.tokensOut).toBe(100_000)
      // Builder is claude-opus-4.6 → $5/M input, $25/M output
      // (current OpenRouter list price).
      // 1_000_000 * 5 / 1e6 + 100_000 * 25 / 1e6 = 5 + 2.5 = 7.5
      expect(run?.costUsd).toBeCloseTo(7.5, 4)
    })

    it('stores nonzero runtime-reported cost and records accounting evidence', async () => {
      const fixture = createFixture({ recordEvidence: true })
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 1_000_000,
        tokensOut: 100_000,
        costUsd: 1.23,
        costState: 'measured',
      })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]!
      const accounting = fixture.context.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'attempt.runtime_accounting')

      expect(run.costUsd).toBeCloseTo(1.23, 4)
      expect(accounting?.payload).toMatchObject({
        source: 'runtime',
        runtimeReportedCostUsd: 1.23,
        computedCostUsd: 7.5,
        storedCostUsd: 1.23,
      })
    })

    it('freezes retryable attempts when input tokens per turn exceed the ceiling', async () => {
      const fixture = createFixture({ recordEvidence: true, attemptCeilings: { maxInputTokensPerTurn: 1_000 } })
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 1_500,
        tokensOut: 10,
        costUsd: 0,
        maxInputTokensInTurn: 1_500,
      })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]!
      const evidence = fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)

      expect(run.terminalState).toBe('frozen')
      expect(run.recoverable).toBe(true)
      expect(run.failReason).toContain('max_turns_paused: attempt input tokens per turn 1500 exceeded cap 1000')
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'attempt.resource_ceiling', ceiling: 'maxInputTokensPerTurn', observed: 1_500, cap: 1_000 }),
        expect.objectContaining({ kind: 'policy', action: 'freeze' }),
      ]))
    })

    it('enforces default input-token ceilings when no config is present', async () => {
      const fixture = createFixture({ recordEvidence: true })
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      const observed = DEFAULT_ATTEMPT_RESOURCE_CEILINGS.maxInputTokensPerTurn + 1
      const expectedCap = defaultMaxInputTokensPerTurnForModel(fixture.builder.model)
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: observed,
        tokensOut: 1,
        costUsd: 0,
        maxInputTokensInTurn: observed,
      })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]!
      const evidence = fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)

      expect(run.terminalState).toBe('frozen')
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'attempt.resource_ceiling', ceiling: 'maxInputTokensPerTurn', observed, cap: expectedCap }),
      ]))
    })

    it('applies cost ceilings to token-only results using computed priced cost', async () => {
      const fixture = createFixture({ recordEvidence: true, attemptCeilings: { maxInputTokensPerTurn: null, maxCumulativeCostUsd: 1 } })
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed',
        tokensIn: 1_000_000,
        tokensOut: 100_000,
        costUsd: 0,
      })
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]!
      const evidence = fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)

      expect(run.terminalState).toBe('frozen')
      expect(run.costUsd).toBeCloseTo(7.5, 4)
      const ceilingEvidence = evidence.find((item) => {
        const payload = item as { kind?: unknown; ceiling?: unknown }
        return payload.kind === 'attempt.resource_ceiling' && payload.ceiling === 'maxCumulativeCostUsd'
      })
      expect(ceilingEvidence).toMatchObject({ kind: 'attempt.resource_ceiling', ceiling: 'maxCumulativeCostUsd', cap: 1 })
      expect(Number(ceilingEvidence?.observed)).toBeCloseTo(7.5, 4)
    })

    it('passes turn and budget ceilings into harness spawn options', async () => {
      const fixture = createFixture({ attemptCeilings: { maxTurns: 7, maxCumulativeCostUsd: 3 } })
      createTask(fixture)
      await fixture.dispatcher.cycle()

      expect(fixture.builderHarness.adapter.spawn.mock.calls[0]?.[4]).toMatchObject({
        maxTurns: 7,
        maxBudgetUsd: 3,
      })
    })
  })
})

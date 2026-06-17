import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - fix loop lineage', () => {
    it('walks the parentRunId chain correctly for a multi-round lineage', async () => {
      const fixture = createFixture()
      // Build: impl → fix-r1 → fix-r2 → fix-r3 chain via parentRunId.
      const { run: impl } = seedImplRun(fixture, 'P1', { worktree: '/tmp/wt' })
      let prev = impl
      const fixRuns: Run[] = []
      for (let i = 1; i <= 3; i += 1) {
        const t = createTask(fixture, { name: `fix-P1-r${i}` })
        const r = fixture.context.runRepo.create({
          id: createId<'RunId'>(),
          taskId: t.id,
          agentId: fixture.builder.id,
          parentRunId: prev.id,
          stage: 'implement',
          terminalState: null,
          resetCount: 0,
          completedStages: [],
          blockedReason: null,
          pendingApproval: false,
          sessionId: `fix-session-${i}`,
          branch: null,
          commitSha: null,
          prNumber: null,
          prUrl: null,
          worktreePaths: ['/tmp/wt'],
          ciStatus: null,
          reviewStatus: null,
          failReason: null,
          recoverable: true,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          lastHeartbeat: fixture.nowRef.value,
          heartbeatTimeoutSeconds: 120,
        })
        fixRuns.push(r)
        prev = r
      }

      // The router's walker should yield all 4 runs in order.
      const chain = fixture.dispatcher.router.walkParentChain(fixRuns[2]!)
      expect(chain.map((r) => r.id)).toEqual([fixRuns[2]!.id, fixRuns[1]!.id, fixRuns[0]!.id, impl.id])
      const root = fixture.dispatcher.router.findRootRun(fixRuns[2]!)
      expect(root?.id).toBe(impl.id)
    })

    it('parseTaskName classifies impl / review / fix task names across rounds', async () => {
      const { parseTaskName } = await import('../../dispatcher.js')
      expect(parseTaskName('P1')).toEqual({ kind: 'impl', originalName: 'P1', round: 0 })
      expect(parseTaskName('review-P1')).toEqual({ kind: 'review', originalName: 'P1', round: 1 })
      expect(parseTaskName('review-P1-r2')).toEqual({ kind: 'review', originalName: 'P1', round: 2 })
      expect(parseTaskName('fix-P1-r1')).toEqual({ kind: 'fix', originalName: 'P1', round: 1 })
      expect(parseTaskName('fix-P1-r7')).toEqual({ kind: 'fix', originalName: 'P1', round: 7 })
      // Ambiguity: an impl task literally named "review-foo" would be a pathological edge.
    })
})
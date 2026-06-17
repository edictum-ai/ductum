import { DAGEvaluator, Dispatcher, WatcherManager, createFixture, createId, createTask, deferred, describe, expect, flush, it, seedImplRun, vi, type PostCompletionConfig, type Run, type Task, type WorktreeManager } from './shared.js'
describe('Dispatcher - stall retry', () => {
  describe('stall retry (P3 split policy)', () => {
    it('marks task failed without auto-retry on heartbeat stall', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)

      // Dispatch the task
      await fixture.dispatcher.cycle()
      expect(fixture.context.taskRepo.get(task.id)?.status).toBe('active')

      // Advance time past heartbeat timeout (120s) → stall detector fires
      fixture.builderHarness.adapter.isAlive.mockResolvedValue(false)
      fixture.nowRef.value = '2026-04-04T12:03:00.000Z'
      await fixture.dispatcher.cycle()
      await flush()
      const run = fixture.context.runRepo.list(task.id)[0]
      expect(run?.terminalState).toBe('stalled')

      // P3 policy: heartbeat stall is NOT auto-retried. Task is failed.
      const updatedTask = fixture.context.taskRepo.get(task.id)!
      expect(updatedTask.status).toBe('failed')
      expect(updatedTask.retryAfter).toBeNull()
    })

    it('retries on session crash with backoff (cause = crash)', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'crashed',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      })
      await flush()
      const updatedTask = fixture.context.taskRepo.get(task.id)!
      // Crashes are still recoverable — they auto-retry.
      expect(updatedTask.status).toBe('ready')
      expect(updatedTask.retryCount).toBe(1)
      expect(updatedTask.retryAfter).not.toBeNull()
    })

    it('respects backoff period for crashed retries', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)

      // Dispatch → crash
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      })
      await flush()

      // Task is ready with retryAfter = now + 10s
      const updated = fixture.context.taskRepo.get(task.id)!
      expect(updated.status).toBe('ready')
      const retryAfterMs = new Date(updated.retryAfter!).getTime()

      // Just before backoff expires — no dispatch.
      fixture.nowRef.value = new Date(retryAfterMs - 1_000).toISOString()
      const result = await fixture.dispatcher.cycle()
      expect(result.tasksDispatched).toEqual([])

      // Backoff expired — dispatch again.
      fixture.nowRef.value = new Date(retryAfterMs + 1_000).toISOString()
      const result2 = await fixture.dispatcher.cycle()
      expect(result2.tasksDispatched).toEqual([task.id])
    })

    it('increases backoff with each crash retry: 10s, 30s, 60s', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)

      // --- Crash 1 → 10s backoff ---
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      })
      await flush()
      let t = fixture.context.taskRepo.get(task.id)!
      expect(t.retryCount).toBe(1)
      let backoff = new Date(t.retryAfter!).getTime() - new Date(fixture.nowRef.value).getTime()
      expect(backoff).toBe(10_000)

      // Advance past backoff and re-dispatch.
      fixture.nowRef.value = new Date(new Date(t.retryAfter!).getTime() + 1_000).toISOString()
      await fixture.dispatcher.cycle()
      // --- Crash 2 → 30s backoff ---
      fixture.builderHarness.sessions[1]?.done.resolve({
        exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      })
      await flush()
      t = fixture.context.taskRepo.get(task.id)!
      expect(t.retryCount).toBe(2)
      backoff = new Date(t.retryAfter!).getTime() - new Date(fixture.nowRef.value).getTime()
      expect(backoff).toBe(30_000)

      // --- Crash 3 → 60s backoff ---
      fixture.nowRef.value = new Date(new Date(t.retryAfter!).getTime() + 1_000).toISOString()
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[2]?.done.resolve({
        exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      })
      await flush()
      t = fixture.context.taskRepo.get(task.id)!
      expect(t.retryCount).toBe(3)
      backoff = new Date(t.retryAfter!).getTime() - new Date(fixture.nowRef.value).getTime()
      expect(backoff).toBe(60_000)
    })

    it('marks task failed after max crash retries (3) and cascades via DAG', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)

      // Pre-set retry count to 3 (already exhausted all retries)
      fixture.context.taskRepo.updateRetry(task.id, 3, null)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'crashed', tokensIn: 0, tokensOut: 0, costUsd: 0,
      })
      await flush()
      const updatedTask = fixture.context.taskRepo.get(task.id)!
      expect(updatedTask.status).toBe('failed')
      expect(updatedTask.retryCount).toBe(4)
    })

    it('does not retry on normal completion', async () => {
      const fixture = createFixture()
      const task = createTask(fixture)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.sessions[0]?.done.resolve({
        exitReason: 'completed', tokensIn: 10, tokensOut: 5, costUsd: 0.1,
      })
      await flush()
      const updatedTask = fixture.context.taskRepo.get(task.id)!
      expect(updatedTask.retryCount).toBe(0)
      expect(updatedTask.retryAfter).toBeNull()
    })

    it('emits task.status_changed events on heartbeat-stall failure', async () => {
      const fixture = createFixture()
      const events: Array<{ type: string; taskId?: string; to?: string }> = []
      fixture.eventEmitter.subscribe((event) => {
        if (event.type === 'task.status_changed') events.push(event)
      })
      const task = createTask(fixture)

      // Dispatch → heartbeat stall → failed (no retry under P3)
      await fixture.dispatcher.cycle()
      fixture.builderHarness.adapter.isAlive.mockResolvedValue(false)
      fixture.nowRef.value = '2026-04-04T12:03:00.000Z'
      await fixture.dispatcher.cycle()
      await flush()
      const failEvent = events.find((e) => e.taskId === task.id && e.to === 'failed')
      expect(failEvent).toBeDefined()
    })
  })
})
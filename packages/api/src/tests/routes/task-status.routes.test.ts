import { describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

describe('API routes - task status recovery', () => {
  it('PUT /api/tasks/:id/status re-enables a prerequisite-blocked task only through explicit operator action', async () => {
    let fixture: TestFixture | undefined
    const cycleDispatcher = vi.fn(async () => {
      const task = fixture == null ? null : seed.taskId == null ? null : fixture.repos.tasks.get(seed.taskId as never)
      if (task != null) fixture!.repos.tasks.updateStatus(task.id, 'active')
      return { tasksEvaluated: 1, tasksDispatched: seed.taskId == null ? [] : [seed.taskId as never], errors: [] }
    })
    const seed: { taskId?: string } = {}
    fixture = await createFixture({ cycleDispatcher })
    try {
      const { task } = seedBase(fixture)
      seed.taskId = task.id
      fixture.repos.tasks.updateStatus(task.id, 'blocked')
      fixture.repos.taskDispatchSkips.record({
        taskId: task.id,
        reason: 'prerequisite-blocked',
        detail: 'Attempt start blocked by prerequisite checks.',
        skippedAt: '2026-06-25T03:00:00.000Z',
      })

      const result = await requestJson(fixture.app, `/api/tasks/${task.id}/status`, {
        method: 'PUT',
        body: { status: 'ready' },
      })

      expect(result.response.status).toBe(200)
      expect(cycleDispatcher).toHaveBeenCalledTimes(1)
      expect(fixture.repos.tasks.get(task.id)?.status).toBe('active')
    } finally {
      fixture?.close()
    }
  })
})

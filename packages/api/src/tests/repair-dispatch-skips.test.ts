import { describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase } from './helpers.js'

describe('repair routes - dispatcher skip visibility', () => {
  it('surfaces a persisted ready-task dispatch skip as a Repair item', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      fixture.repos.taskDispatchSkips.record({
        taskId: task.id,
        reason: 'worktree-contention',
        detail: 'worktree held by an in-flight run',
        skippedAt: '2026-06-25T03:00:00.000Z',
      })

      const result = await requestJson(fixture.app, '/api/repair')
      expect(result.response.status).toBe(200)
      const report = result.json as {
        items: Array<{ area: string; issueCode: string | null; reason: string; target: { taskId?: string } | null }>
      }
      expect(report.items).toContainEqual(expect.objectContaining({
        area: 'dispatcher_visibility',
        issueCode: 'dispatch_skip:worktree-contention',
        target: expect.objectContaining({ taskId: task.id }),
        reason: expect.stringContaining('worktree held by an in-flight run'),
      }))
    } finally {
      fixture.close()
    }
  })
})

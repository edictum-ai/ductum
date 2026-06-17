import { describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase } from '../helpers.js'

describe('API routes - task sync', () => {
  it('updates a task prompt in place', async () => {
    const fixture = await createFixture()
    try {
      const { task } = seedBase(fixture)
      const result = await requestJson(fixture.app, `/api/tasks/${task.id}/prompt`, {
        method: 'PUT',
        body: { prompt: 'updated prompt' },
      })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ id: task.id, prompt: 'updated prompt' })
      expect(fixture.repos.tasks.get(task.id)?.prompt).toBe('updated prompt')
    } finally {
      fixture.close()
    }
  })
})

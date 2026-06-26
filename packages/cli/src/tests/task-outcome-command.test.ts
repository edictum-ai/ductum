import { describe, expect, it, vi } from 'vitest'

import { acceptedRun, agent, createMockApi, readyTask, runCommand } from './helpers.js'

describe('task outcome command', () => {
  it('records an external task outcome', async () => {
    const recordTaskExternalOutcome = vi.fn().mockResolvedValue({
      task: { ...readyTask, status: 'done' },
      run: { ...acceptedRun, taskId: readyTask.id, stage: 'done' },
      agent,
      evidence: {
        id: 'evidence-outcome' as never,
        runId: acceptedRun.id,
        type: 'custom',
        payload: { kind: 'external-outcome', outcome: 'superseded', reason: 'superseded by later proof' },
        createdAt: '2026-04-04T12:00:00.000Z',
      },
      alreadyRecorded: false,
    })
    const api = createMockApi({ recordTaskExternalOutcome })

    const result = await runCommand([
      'task',
      'outcome',
      readyTask.id,
      '--outcome',
      'superseded',
      '--reason',
      'superseded by later proof',
      '--author',
      'operator',
    ], api)

    expect(result.code).toBe(0)
    expect(recordTaskExternalOutcome).toHaveBeenCalledWith(readyTask.id, {
      outcome: 'superseded',
      reason: 'superseded by later proof',
      author: 'operator',
      runId: undefined,
      branch: undefined,
      commitSha: undefined,
      sourcePath: undefined,
    })
    expect(result.text).toContain(`task: ${readyTask.id}`)
    expect(result.text).toContain('outcome: superseded')
  })
})

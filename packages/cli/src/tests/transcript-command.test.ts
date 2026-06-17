import type { Run, RunActivity, RunUpdate } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import { activeRun, createMockApi, runCommand } from './helpers.js'

describe('ductum logs command', () => {
  it('prints progress, activity, and the exact next watch command for live runs', async () => {
    const updates: RunUpdate[] = [
      { id: 1, runId: activeRun.id, message: 'Started implementation', createdAt: activeRun.createdAt },
    ]
    const activity: RunActivity[] = [
      {
        id: 1,
        runId: activeRun.id,
        kind: 'tool_call',
        toolName: 'shell',
        content: '{"command":"pnpm --filter @ductum/cli test"}',
        createdAt: activeRun.createdAt,
      },
      {
        id: 2,
        runId: activeRun.id,
        kind: 'result',
        toolName: null,
        content: 'All CLI tests passed',
        createdAt: activeRun.createdAt,
      },
    ]
    const api = createMockApi({
      getRunUpdates: vi.fn().mockResolvedValue(updates),
      getRunActivity: vi.fn().mockResolvedValue(activity),
    })

    const result = await runCommand(['logs', activeRun.id], api)

    expect(result.code).toBe(0)
    expect(result.text).toContain('Started implementation')
    expect(result.text).toContain('pnpm --filter @ductum/cli test')
    expect(result.text).toContain('All CLI tests passed')
    expect(result.text).toContain(`ductum watch ${activeRun.id}`)
  })

  it('shows approval and recovery commands when a run is stuck', async () => {
    const awaitingApproval: Run = { ...activeRun, stage: 'ship', pendingApproval: true }
    const failed: Run = { ...activeRun, terminalState: 'failed', failReason: 'tests failed' }
    const api = createMockApi({
      getRun: vi.fn()
        .mockResolvedValueOnce(awaitingApproval)
        .mockResolvedValueOnce(failed),
      getRunUpdates: vi.fn().mockResolvedValue([]),
      getRunActivity: vi.fn().mockResolvedValue([]),
    })

    const approval = await runCommand(['logs', activeRun.id], api)
    const recovery = await runCommand(['logs', activeRun.id], api)

    expect(approval.text).toContain(`ductum approve ${activeRun.id}`)
    expect(approval.text).toContain(`ductum deny ${activeRun.id}`)
    expect(recovery.text).toContain(`ductum retry ${activeRun.id}`)
    expect(recovery.text).not.toContain('run-close')
  })
})

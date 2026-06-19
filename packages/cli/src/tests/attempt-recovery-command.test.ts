import { describe, expect, it, vi } from 'vitest'

import { activeRun, activeTask, createMockApi, runCommand } from './helpers.js'

describe('attempt recovery commands', () => {
  it('extends and denies budget-paused Attempts under the attempt command group', async () => {
    const api = createMockApi()

    const extended = await runCommand(
      ['attempt', 'budget-extend', activeRun.id, '--by', '25.5', '--reason', 'approved overage'],
      api,
    )
    const denied = await runCommand(
      ['attempt', 'budget-deny', activeRun.id, '--reason', 'scope changed'],
      api,
    )

    expect(extended.code).toBe(0)
    expect(api.budgetExtend).toHaveBeenCalledWith(activeRun.id, 25.5, 'approved overage')
    expect(extended.text).toContain('budgetExtraUsd')
    expect(denied.code).toBe(0)
    expect(api.budgetDeny).toHaveBeenCalledWith(activeRun.id, 'scope changed')
    expect(denied.text).toContain('cost_budget_denied')
  })

  it('extends and denies max-turns Attempts under the attempt command group', async () => {
    const api = createMockApi({
      turnsExtend: vi.fn().mockResolvedValue({
        ok: true,
        runId: activeRun.id,
        taskId: activeTask.id,
        turnExtraCount: 150,
        failReason: 'max_turns_paused',
      }),
    })

    const extended = await runCommand(
      ['attempt', 'turns-extend', activeRun.id, '--by', '150', '--reason', 'needs final verification'],
      api,
    )
    const denied = await runCommand(
      ['attempt', 'turns-deny', activeRun.id, '--reason', 'superseded'],
      api,
    )

    expect(extended.code).toBe(0)
    expect(api.turnsExtend).toHaveBeenCalledWith(activeRun.id, 150, 'needs final verification')
    expect(extended.text).toContain('turnExtraCount')
    expect(denied.code).toBe(0)
    expect(api.turnsDeny).toHaveBeenCalledWith(activeRun.id, 'superseded')
    expect(denied.text).toContain('max_turns_denied')
  })

  it('rejects invalid recovery amounts before calling the API', async () => {
    const api = createMockApi()

    const result = await runCommand(['attempt', 'turns-extend', activeRun.id, '--by', '1.5'], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--by must be a positive integer')
    expect(api.turnsExtend).not.toHaveBeenCalled()
  })
})

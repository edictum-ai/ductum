import type { AgentHealthState } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

let fixture: TestFixture | null = null

afterEach(() => {
  fixture?.close()
  fixture = null
})

describe('agent health routes', () => {
  it('returns dispatcher health before the generic agent id route', async () => {
    fixture = await createFixture({
      getAgentHealth: () => [{
        agentId: 'agent-1' as AgentHealthState['agentId'],
        agentName: 'mimi',
        recentFailures: 3,
        unhealthy: true,
        unhealthyUntil: '2026-04-04T12:05:00.000Z',
        unhealthyReason: '3 recent failures: prompt_overflow',
        lastFailureAt: '2026-04-04T12:00:00.000Z',
      }],
    })

    const result = await requestJson(fixture.app, '/api/agents/health')

    expect(result.response.status).toBe(200)
    expect(result.json).toEqual({
      agents: [{
        agentId: 'agent-1',
        agentName: 'mimi',
        recentFailures: 3,
        unhealthy: true,
        unhealthyUntil: '2026-04-04T12:05:00.000Z',
        unhealthyReason: '3 recent failures: prompt_overflow',
        lastFailureAt: '2026-04-04T12:00:00.000Z',
      }],
    })
  })

  it('resets health by agent name', async () => {
    const resetAgentHealth = vi.fn().mockReturnValue(true)
    fixture = await createFixture({ resetAgentHealth })
    const { builder } = seedBase(fixture)

    const result = await requestJson(fixture.app, `/api/agents/${builder.name}/health/reset`, {
      method: 'POST',
    })

    expect(result.response.status).toBe(200)
    expect(resetAgentHealth).toHaveBeenCalledWith(builder.name)
    expect(result.json).toEqual({
      ok: true,
      reset: true,
      agent: { id: builder.id, name: builder.name },
    })
  })
})

import { createFixture, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, vi, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - run completion routing', () => {
  it('POST /api/runs/:id/complete returns the routed state when teardown routes synchronously', async () => {
    let runId = ''
    const endSession = vi.fn(async () => {
      fixture!.context.stateMachine.markDone(runId as never, 'completion routed synchronously')
    })
    fixture = await createFixture({ endSession, hasActiveSession: () => true })
    const { task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST', body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    runId = (accept.json as { id: string }).id

    const complete = await requestJson(fixture.app, `/api/runs/${runId}/complete`, {
      method: 'POST', body: { result: 'implemented enough detail to route immediately' },
    })

    expect(complete.response.status).toBe(200)
    expect(endSession).toHaveBeenCalledWith(runId)
    expect((complete.json as { stage: string }).stage).toBe('done')
    expect((complete.json as { terminalState: string | null }).terminalState).toBeNull()
  })
})

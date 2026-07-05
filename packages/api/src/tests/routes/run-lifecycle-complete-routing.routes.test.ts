import { createFixture, describe, expect, it, registerRouteTestCleanup, requestJson, seedBase, vi, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - run completion routing', () => {
  it('POST /api/runs/:id/complete returns the pre-routing state and routes on the next tick', async () => {
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

    // Response reflects the run state at completion time, before the
    // scheduled teardown callback can route the run to done.
    expect(complete.response.status).toBe(200)
    expect((complete.json as { stage: string }).stage).toBe('understand')
    expect((complete.json as { terminalState: string | null }).terminalState).toBeNull()

    // The scheduled endSession callback still runs and routes the run.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(endSession).toHaveBeenCalledWith(runId)
    expect(fixture!.context.repos.runs.get(runId as never)?.stage).toBe('done')
  })

  it('POST /api/runs/:id/complete returns 200 before a slow endSession promise resolves', async () => {
    let resolveEndSession: () => void = () => { throw new Error('endSession not scheduled') }
    const endSession = vi.fn(() => new Promise<void>((resolve) => {
      resolveEndSession = resolve
    }))
    fixture = await createFixture({ endSession, hasActiveSession: () => true })
    const { task, builder } = seedBase(fixture)
    const accept = await requestJson(fixture.app, '/api/runs/accept', {
      method: 'POST', body: { taskId: task.id, agentId: builder.id, sessionId: 'session-1' },
    })
    const runId = (accept.json as { id: string }).id

    // Race the route response against a tight timeout. If the route awaits
    // endSession, this resolves with a timeout and the assertion fails.
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 25))
    const complete = await Promise.race([
      requestJson(fixture.app, `/api/runs/${runId}/complete`, {
        method: 'POST', body: { result: 'implemented while teardown is intentionally unresolved' },
      }),
      timeout,
    ])

    expect(complete).not.toBe('timeout')
    expect((complete as { json: { stage: string } }).json.stage).toBe('understand')

    // The scheduled callback runs on the next tick even while the
    // endSession promise itself remains unresolved.
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(endSession).toHaveBeenCalledWith(runId)

    // Release the suspended teardown so the test harness can clean up.
    resolveEndSession()
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
})

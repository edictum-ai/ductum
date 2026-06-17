import { createFixture, createTask, describe, expect, it } from './dispatcher/shared.js'

describe('dispatcher runtime settings', () => {
  it('applies heartbeat timeout changes only to future runs', async () => {
    const fixture = createFixture()

    const firstTask = createTask(fixture)
    const firstRun = await fixture.dispatcher.manualDispatch(firstTask.id, fixture.builder.id)
    expect(firstRun.heartbeatTimeoutSeconds).toBe(120)

    fixture.dispatcher.setHeartbeatTimeoutSeconds(240)
    expect(fixture.dispatcher.runtimeConfig()).toMatchObject({ heartbeatTimeoutSeconds: 240 })

    const secondTask = createTask(fixture)
    const secondRun = await fixture.dispatcher.manualDispatch(secondTask.id, fixture.builder.id)

    expect(secondRun.heartbeatTimeoutSeconds).toBe(240)
    expect(fixture.context.runRepo.get(firstRun.id)?.heartbeatTimeoutSeconds).toBe(120)
  })
})

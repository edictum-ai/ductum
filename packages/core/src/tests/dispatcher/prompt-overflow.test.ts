import { createFixture, createTask, describe, expect, flush, it } from './shared.js'

describe('Dispatcher - prompt overflow', () => {
  it('marks prompt_overflow harness failures as failed and records evidence', async () => {
    const fixture = createFixture({ recordEvidence: true })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      failReason: 'prompt_overflow',
      failureEvidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
      },
      tokensIn: 100,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()

    const updatedRun = fixture.context.runRepo.get(run.id)!
    expect(updatedRun.terminalState).toBe('failed')
    expect(updatedRun.failReason).toBe('prompt_overflow')
    expect(fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)).toContainEqual({
      kind: 'harness.failure',
      reason: 'prompt_overflow',
      exitReason: 'failed',
      evidence: {
        kind: 'claude-agent-sdk.prompt_overflow',
        signature: 'Prompt is too long',
        resultTextEmpty: true,
      },
    })
  })

  it('marks max_turns_reached harness failures recoverable and records suggested actions', async () => {
    const fixture = createFixture({ recordEvidence: true })
    const task = createTask(fixture)

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.builderHarness.sessions[0]?.done.resolve({
      exitReason: 'failed',
      failReason: 'max_turns_reached',
      failureEvidence: {
        kind: 'claude-agent-sdk.max_turns_reached',
        currentLimit: 200,
        suggestedLimit: 300,
        suggestedActions: [{ kind: 'bump_max_turns', args: { currentLimit: 200, suggestedLimit: 300 } }],
      },
      tokensIn: 100,
      tokensOut: 0,
      costUsd: 0,
    })
    await flush()

    const updatedRun = fixture.context.runRepo.get(run.id)!
    expect(updatedRun.terminalState).toBe('failed')
    expect(updatedRun.failReason).toBe('max_turns_reached')
    expect(updatedRun.recoverable).toBe(true)
    expect(fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)).toContainEqual({
      kind: 'harness.failure',
      reason: 'max_turns_reached',
      exitReason: 'failed',
      evidence: {
        kind: 'claude-agent-sdk.max_turns_reached',
        currentLimit: 200,
        suggestedLimit: 300,
        suggestedActions: [{ kind: 'bump_max_turns', args: { currentLimit: 200, suggestedLimit: 300 } }],
      },
    })
  })
})

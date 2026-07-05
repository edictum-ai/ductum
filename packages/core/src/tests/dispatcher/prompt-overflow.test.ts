import { createFixture, createTask, describe, expect, flush, it } from './shared.js'

describe('Dispatcher - prompt overflow', () => {
  it('freezes first-turn prompt_overflow as a retryable ceiling failure', async () => {
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
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      turns: 0,
      maxInputTokensInTurn: 0,
    })
    await flush()

    const updatedRun = fixture.context.runRepo.get(run.id)!
    const evidence = fixture.context.evidenceRepo.list(run.id).map((item) => item.payload)
    expect(updatedRun.terminalState).toBe('frozen')
    expect(updatedRun.recoverable).toBe(true)
    expect(updatedRun.failReason).toContain('max_turns_paused: attempt input tokens per turn')
    expect(updatedRun.failReason).not.toBe('prompt_overflow')
    expect(evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'attempt.resource_ceiling', ceiling: 'maxInputTokensPerTurn', originalExitReason: 'failed', nextExitReason: 'paused-max-turns' }),
      expect.objectContaining({ kind: 'policy', action: 'freeze' }),
    ]))
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

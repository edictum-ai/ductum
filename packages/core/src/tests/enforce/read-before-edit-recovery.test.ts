import { createFixture, describe, expect, it } from './shared.js'

describe('EnforcementManager read-before-edit recovery', () => {
  it('recovers from a blocked understand-stage write after a supported local README read', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: process.cwd(),
    })

    const writeResult = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'notes.md',
      content: 'blocked until README is read',
    })

    expect(writeResult).toMatchObject({ allowed: false })
    expect(writeResult.reason).toContain('Read README.md before editing')
    expect(writeResult.reason).toContain('Read README.md')
    expect(writeResult.reason).not.toContain('cat README.md')
    expect(fixture.context.runRepo.get(fixture.run.id)?.blockedReason).toContain('supported local repo read')
    const blockedState = await fixture.manager.getWorkflowState(fixture.run.id) as { blockedReason?: string | null }
    expect(blockedState).toMatchObject({
      blockedReason: expect.stringContaining('supported local repo read'),
    })

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: 'README.md',
    })

    const stateAfter = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(stateAfter.activeStage).toBe('implement')
    expect(fixture.context.runRepo.get(fixture.run.id)).toMatchObject({
      stage: 'implement',
      blockedReason: null,
    })
  })

  it('does not persist blocked run state for observed read-before-edit blocks', async () => {
    const fixture = createFixture('understand', { observerMode: true })
    await fixture.manager.initialize()

    const writeResult = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'notes.md',
      content: 'observed only',
    })

    expect(writeResult).toMatchObject({ allowed: true })
    expect(writeResult.reason).toContain('supported local repo read')
    expect(writeResult.reason).not.toContain('cat README.md')
    expect(fixture.context.runRepo.get(fixture.run.id)?.blockedReason).toBeNull()
    expect(fixture.context.gateEvaluationRepo.list(fixture.run.id)).toEqual([
      expect.objectContaining({
        observed: true,
        result: 'blocked',
        reason: expect.stringContaining('Read README.md before editing'),
      }),
    ])
  })
})

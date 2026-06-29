import { writeFileSync } from 'node:fs'

import { createFixture, createWorkflowSession, describe, expect, it, mkdtempSync, normalizeWorkflowToolArgs, resolve, tempDirs, tmpdir } from './shared.js'

describe('EnforcementManager workflow state', () => {
  it('getWorkflowState returns the current workflow state', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('understand')
    expect(state.completedStages).toEqual([])
  })

  it('getWorkflowState reflects advancement after recordToolSuccess', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: process.cwd(),
    })

    // Record reading README.md — the exit condition for understand
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve('README.md'),
    })

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('implement')
  })

  it('recordToolSuccess does not throw for valid calls', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const stateBefore = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(stateBefore.activeStage).toBe('understand')

    // Record a successful Read tool — should not throw
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: 'src/index.ts',
    })

    const stateAfter = await fixture.manager.getWorkflowState(fixture.run.id)
    // Still in understand since we haven't read README.md (exit condition)
    expect(stateAfter.activeStage).toBe('understand')
  })

  it('uses CLAUDE.md as the read gate when the repository has no README', async () => {
    const fixture = createFixture('understand')
    const repoDir = mkdtempSync(`${tmpdir()}/ductum-claude-gate-`)
    tempDirs.push(repoDir)
    writeFileSync(resolve(repoDir, 'CLAUDE.md'), 'repo guidance\n')
    const task = fixture.context.taskRepo.get(fixture.run.taskId)!
    const projectId = fixture.context.specRepo.get(task.specId)!.projectId
    fixture.context.repositoryRepo.upsert(projectId, 'packages/core', { localPath: repoDir })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: repoDir,
    })

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve(repoDir, 'CLAUDE.md'),
    })

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('implement')
    expect(state.evidence.reads).toContain('CLAUDE.md')
    expect(state.evidence.reads).not.toContain('README.md')
  })

  it('keeps README.md as the read gate when both README and CLAUDE exist', async () => {
    const fixture = createFixture('understand')
    const repoDir = mkdtempSync(`${tmpdir()}/ductum-readme-gate-`)
    tempDirs.push(repoDir)
    writeFileSync(resolve(repoDir, 'README.md'), 'readme\n')
    writeFileSync(resolve(repoDir, 'CLAUDE.md'), 'repo guidance\n')
    const task = fixture.context.taskRepo.get(fixture.run.taskId)!
    const projectId = fixture.context.specRepo.get(task.specId)!.projectId
    fixture.context.repositoryRepo.upsert(projectId, 'packages/core', { localPath: repoDir })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: repoDir,
    })

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve(repoDir, 'CLAUDE.md'),
    })
    expect((await fixture.manager.getWorkflowState(fixture.run.id)).activeStage).toBe('understand')

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve(repoDir, 'README.md'),
    })
    expect((await fixture.manager.getWorkflowState(fixture.run.id)).activeStage).toBe('implement')
  })

  it('recordToolSuccess is a no-op for done stage', async () => {
    const fixture = createFixture('done')
    await fixture.manager.initialize()

    // Should not throw or modify state
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: 'README.md',
    })
  })

  it('recordToolSuccess is a no-op for terminal state', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    fixture.context.runRepo.updateTerminalState(fixture.run.id, 'stalled')

    // Should not throw
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: 'README.md',
    })
  })

  it('immediately advances to implement after reading README from the run working dir', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: process.cwd(),
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve('README.md'),
    })

    const state = await runtime.state(session)
    expect(state.activeStage).toBe('implement')
    expect(state.evidence.reads).toContain('README.md')
  })

  it('records command evidence in the current stage', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    await fixture.manager.recordToolSuccess(fixture.run.id, 'Bash', {
      command: 'git switch feat/p1-condition-matching',
    })

    const state = await runtime.state(session)
    expect(state.activeStage).toBe('implement')
    expect(state.evidence.stageCalls['implement']).toContain(
      'git switch feat/p1-condition-matching',
    )
  })

  it('normalizes absolute workflow file paths before recording evidence', () => {
    expect(
      normalizeWorkflowToolArgs('Read', { file_path: resolve('README.md') }).file_path,
    ).toBe('README.md')
    expect(
      normalizeWorkflowToolArgs('Read', {
        file_path: resolve('packages/core/src/index.ts'),
      }).file_path,
    ).toBe('packages/core/src/index.ts')
    expect(
      normalizeWorkflowToolArgs(
        'Read',
        { file_path: '/tmp/README.md' },
        { baseDir: '/Users/acartagena/project/ductum' },
      ).file_path,
    ).toBe('/tmp/README.md')
    expect(
      normalizeWorkflowToolArgs(
        'Write',
        {
          changes: [
            { path: '/Users/acartagena/project/ductum/packages/core/src/index.ts', kind: 'update' },
            { path: '/tmp/outside.ts', kind: 'update' },
          ],
        },
        { baseDir: '/Users/acartagena/project/ductum' },
      ).changes,
    ).toEqual([
      { path: 'packages/core/src/index.ts', kind: 'update' },
      { path: '/tmp/outside.ts', kind: 'update' },
    ])
    expect(
      normalizeWorkflowToolArgs('Bash', { command: 'git switch feat/p1' }).command,
    ).toBe('git switch feat/p1')
  })

  it('recordApproval throws when no approval is pending', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    await expect(
      fixture.manager.recordApproval(fixture.run.id),
    ).rejects.toThrow(/does not require approval/)
  })

  it('resetToStage moves workflow backward and increments reset count', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    // Advance workflow to ship
    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'ship')

    // Reset back to implement
    await fixture.manager.resetToStage(fixture.run.id, 'implement')

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('implement')

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.resetCount).toBe(1)
  })

  it('resetToStage increments reset count cumulatively', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)

    // First reset
    await runtime.setStage(session, 'ship')
    await fixture.manager.resetToStage(fixture.run.id, 'implement')

    // Second reset
    await runtime.setStage(session, 'ship')
    await fixture.manager.resetToStage(fixture.run.id, 'implement')

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.resetCount).toBe(2)
  })

  it('records gate evaluations for authorize_tool', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    await fixture.manager.authorizeTool(fixture.run.id, 'Read', {
      file_path: 'README.md',
    })
    await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'test.ts',
      content: '// test',
    })

    const evaluations = fixture.context.gateEvaluationRepo.list(fixture.run.id)
    expect(evaluations).toHaveLength(2)
    expect(evaluations.map((e) => e.gateType)).toEqual([
      'authorize_tool',
      'authorize_tool',
    ])
    // Read is allowed in understand, Write is blocked
    expect(evaluations.map((e) => e.result)).toEqual(['allowed', 'blocked'])
  })

  it('blocks git push even from implement stage', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const pushResult = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'git push origin main',
    })
    expect(pushResult.allowed).toBe(false)
    expect(pushResult.reason).toContain('GitHub branch, PR, and issue lifecycle commands')
  })

})

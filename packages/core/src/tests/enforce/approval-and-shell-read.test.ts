import { collectWorkflowReadPathCandidates, createFixture, createWorkflowSession, describe, expect, extractWorkflowReadPath, it, resolve } from './shared.js'

describe('EnforcementManager approval and shell-read lifecycle', () => {
  it('advanceToStage moves a run into ship and exposes pending approval', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(true)
  })

  it('keeps external-review runs blocked in ship until link metadata and watchers are green', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    const task = fixture.context.taskRepo.get(fixture.run.taskId)!
    const spec = fixture.context.specRepo.get(task.specId)!
    const project = fixture.context.projectRepo.get(spec.projectId)!
    fixture.context.projectRepo.update(project.id, {
      config: { ...project.config, externalReviewRequired: true },
    })

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')

    let run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.pendingApproval).toBe(false)
    expect(run?.blockedReason).toContain('missing branch, commitSha, and prUrl')

    fixture.context.runRepo.updateGitArtifacts(fixture.run.id, {
      branch: 'feat/parity-loop',
      commitSha: 'abc123',
      prUrl: 'https://github.com/acartag7/ductum/pull/42',
    })
    await fixture.manager.syncRunState(fixture.run.id)

    run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.pendingApproval).toBe(false)
    expect(run?.blockedReason).toContain('waiting for external CI and external GitHub review')

    fixture.context.runRepo.updateLatchStatus(fixture.run.id, 'ciStatus', 'pass')
    fixture.context.runRepo.updateLatchStatus(fixture.run.id, 'reviewStatus', 'pass')
    await fixture.manager.syncRunState(fixture.run.id)

    run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.pendingApproval).toBe(true)
    expect(run?.blockedReason).toBeNull()
  })

  it('recordApproval clears a stage-level approval after factory advance', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')
    await fixture.manager.recordApproval(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('ship')
    expect(run?.pendingApproval).toBe(false)
  })

  it('syncRunState does not restore pending approval after the run is already marked done', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    await fixture.manager.advanceToStage(fixture.run.id, 'ship')
    expect(fixture.context.runRepo.get(fixture.run.id)?.pendingApproval).toBe(true)

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const originalState = runtime.state.bind(runtime)
    runtime.state = async (...args) => {
      fixture.stateMachine.markDone(fixture.run.id, 'merged')
      return await originalState(...args)
    }

    await fixture.manager.syncRunState(fixture.run.id)

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('done')
    expect(run?.pendingApproval).toBe(false)
  })

  it('refreshes run stage after workflow advancement via recordToolSuccess', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'claude-agent-sdk',
      workingDir: process.cwd(),
    })

    // Record reading README.md — triggers advance from understand to implement
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', {
      file_path: resolve('README.md'),
    })

    // The Run record should have been updated to reflect the new stage
    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('implement')
  })

  it('advances understand stage when shell-recognized reads land as Read evidence', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-app-server',
      workingDir: process.cwd(),
    })

    // The codex harness sees this compound shell command, classifies it via
    // the shared `extractWorkflowReadPath` / `collectWorkflowReadPathCandidates`
    // helpers, and emits a `Read` tool.result per recognized file.
    const command = '/bin/zsh -lc "sed -n \'1,200p\' README.md && sed -n \'1,200p\' CLAUDE.md"'
    const primary = extractWorkflowReadPath(command)
    const candidates = collectWorkflowReadPathCandidates(command)
    expect(primary).toBe('README.md')
    expect(candidates).toEqual(expect.arrayContaining(['README.md', 'CLAUDE.md']))

    // Replay every recognized path through the existing enforcement entrypoint
    // exactly the way the harness would after receiving `item/completed`.
    for (const filePath of candidates) {
      await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', { file_path: filePath })
    }

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('implement')

    const run = fixture.context.runRepo.get(fixture.run.id)
    expect(run?.stage).toBe('implement')
  })

  it('does not advance understand stage when no shell command read is recognized', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-app-server',
      workingDir: process.cwd(),
    })

    // Mutating shell control flow MUST stay classified as Bash and MUST NOT
    // produce read evidence — defensive guard against broad shell-output
    // inference.
    const mutating = '/bin/zsh -lc "for f in decisions/*; do rm \\"$f\\"; done"'
    expect(extractWorkflowReadPath(mutating)).toBeNull()
    expect(collectWorkflowReadPathCandidates(mutating)).toEqual([])

    // Recording the original Bash command should keep the run in understand —
    // arbitrary shell output never counts as a file read.
    await fixture.manager.recordToolSuccess(fixture.run.id, 'Bash', { command: mutating })

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('understand')
  })

  it('keeps the read gate idle for compound reads that do not include README', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-app-server',
      workingDir: process.cwd(),
    })

    // Ambiguous multi-file reads without README stay unclassified; recording
    // each individual path as Read MUST NOT advance the understand gate
    // because the workflow exit condition is `file_read("README.md")`.
    const command = 'cat packages/core/package.json && cat packages/api/package.json'
    expect(extractWorkflowReadPath(command)).toBeNull()
    const candidates = collectWorkflowReadPathCandidates(command)
    expect(candidates).toEqual(['packages/core/package.json', 'packages/api/package.json'])

    for (const filePath of candidates) {
      await fixture.manager.recordToolSuccess(fixture.run.id, 'Read', { file_path: filePath })
    }

    const state = await fixture.manager.getWorkflowState(fixture.run.id)
    expect(state.activeStage).toBe('understand')
  })

  it('disposeRuntime cleans up the cached runtime', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    // Access runtime to cache it
    fixture.manager.getRuntime(fixture.run.id)

    // Dispose should not throw
    fixture.manager.disposeRuntime(fixture.run.id)

    // Getting runtime again creates a fresh one (no error)
    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    const state = await runtime.state(session)
    expect(state.activeStage).toBe('understand')
  })
})

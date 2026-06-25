import { createFixture, createWorkflowSession, describe, expect, it, join, mkdirSync, mkdtempSync, relative, resolve, symlinkSync, tempDirs, tmpdir } from './shared.js'

describe('EnforcementManager authorization gates', () => {
  it('blocks tools in understand stage that are not Read/Grep/Glob/Bash', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    // Write is NOT allowed in understand — only Read, Grep, Glob, Bash
    const writeResult = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'packages/core/src/index.ts',
      content: 'export {}',
    })
    expect(writeResult.allowed).toBe(false)

    // Read IS allowed in understand
    const readResult = await fixture.manager.authorizeTool(fixture.run.id, 'Read', {
      file_path: 'README.md',
    })
    expect(readResult.allowed).toBe(true)
  })

  it('allows tools matching the implement stage', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    // Set the workflow to implement stage
    const session = createWorkflowSession(fixture)
    const runtime = fixture.manager.getRuntime(fixture.run.id)
    await runtime.setStage(session, 'implement')

    // Write IS allowed in implement stage
    const writeResult = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'packages/core/src/index.ts',
      content: 'export {}',
    })
    expect(writeResult.allowed).toBe(true)

    // Edit IS allowed in implement stage
    const editResult = await fixture.manager.authorizeTool(fixture.run.id, 'Edit', {
      file_path: 'packages/core/src/index.ts',
      old_string: 'export {}',
      new_string: 'export { foo }',
    })
    expect(editResult.allowed).toBe(true)
  })
  it('blocks file tools that escape the run working directory', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: '/tmp/ductum-run-worktree',
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const absoluteResult = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: resolve('packages/core/src/index.ts'),
      content: 'export {}',
    })
    const relativeResult = await fixture.manager.authorizeTool(fixture.run.id, 'Edit', {
      file_path: '../ductum-main/packages/core/src/index.ts',
      old_string: 'export {}',
      new_string: 'export { blocked }',
    })

    expect(absoluteResult).toMatchObject({ allowed: false })
    expect(relativeResult).toMatchObject({ allowed: false })
    expect(absoluteResult.reason).toContain('outside the run working directory')
    expect(fixture.context.gateEvaluationRepo.list(fixture.run.id).map((item) => item.result)).toEqual([
      'blocked',
      'blocked',
    ])
    expect(fixture.context.runRepo.get(fixture.run.id)?.blockedReason).toContain('outside the run working directory')
    expect(fixture.context.evidenceRepo.list(fixture.run.id).map((item) => item.payload)).toEqual([
      expect.objectContaining({
        kind: 'tool.path_blocked',
        toolName: 'Write',
        args: expect.objectContaining({
          file_path: resolve('packages/core/src/index.ts'),
        }),
      }),
      expect.objectContaining({
        kind: 'tool.path_blocked',
        toolName: 'Edit',
        args: expect.objectContaining({
          file_path: '../ductum-main/packages/core/src/index.ts',
        }),
      }),
    ])
  })

  it('blocks Bash commands that reference the live factory database path', async () => {
    const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-factory-db-'))
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-run-base-'))
    tempDirs.push(factoryDir, baseDir)
    const dbPath = join(factoryDir, 'ductum.db')
    const fixture = createFixture('implement', { protectedShellPaths: [dbPath] })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: baseDir,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: `sqlite3 ${dbPath} ".tables"`,
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('protected factory database path')
    expect(fixture.context.gateEvaluationRepo.list(fixture.run.id).map((item) => item.result)).toEqual([
      'blocked',
    ])
    expect(fixture.context.runRepo.get(fixture.run.id)?.blockedReason).toContain(
      'use the Ductum CLI/API',
    )
    expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
      kind: 'tool.command_blocked',
      toolName: 'Bash',
      baseDir,
      reason: expect.stringContaining('protected factory database path'),
      args: {
        command: `sqlite3 ${dbPath} ".tables"`,
      },
    })
  })

  it('blocks Bash commands that reach the factory database through a relative traversal', async () => {
    const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-factory-db-'))
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-run-base-'))
    tempDirs.push(factoryDir, baseDir)
    const dbPath = join(factoryDir, 'ductum.db')
    const relativeDbPath = relative(baseDir, dbPath)
    const fixture = createFixture('implement', { protectedShellPaths: [dbPath] })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: baseDir,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: `sqlite3 ${relativeDbPath} ".tables"`,
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('protected factory database path')
  })

  it('allows Bash commands that inspect an unprotected local sqlite file', async () => {
    const factoryDir = mkdtempSync(join(tmpdir(), 'ductum-factory-db-'))
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-run-base-'))
    tempDirs.push(factoryDir, baseDir)
    const fixture = createFixture('implement', {
      protectedShellPaths: [join(factoryDir, 'ductum.db')],
    })
    await fixture.manager.initialize()
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: baseDir,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'sqlite3 ./local-dev.db ".tables"',
    })

    expect(result).toMatchObject({ allowed: true })
  })

  it('blocks nested write paths outside the run working directory and records the attempted path key', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-run-base-'))
    tempDirs.push(baseDir)
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: baseDir,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const outsidePath = resolve('packages/cli/src/spec-import-decisions.ts')
    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      changes: [
        { path: join(baseDir, 'packages/core/src/index.ts'), kind: 'update' },
        { path: outsidePath, kind: 'update' },
      ],
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('changes[1].path')
    expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
      kind: 'tool.path_blocked',
      args: {
        changes: [
          { path: 'packages/core/src/index.ts', kind: 'update' },
          { path: outsidePath, kind: 'update' },
        ],
      },
    })
  })

  it('blocks symlink escapes even when the target file does not exist yet', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()
    const baseDir = mkdtempSync(join(tmpdir(), 'ductum-run-base-'))
    const outsideDir = mkdtempSync(join(tmpdir(), 'ductum-run-outside-'))
    tempDirs.push(baseDir, outsideDir)
    mkdirSync(join(baseDir, 'links'), { recursive: true })
    symlinkSync(outsideDir, join(baseDir, 'links', 'escape'))
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'session-1',
      runId: fixture.run.id,
      harness: 'codex-sdk',
      workingDir: baseDir,
    })

    const runtime = fixture.manager.getRuntime(fixture.run.id)
    const session = createWorkflowSession(fixture)
    await runtime.setStage(session, 'implement')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Write', {
      file_path: 'links/escape/new-file.ts',
      content: 'export const escaped = true',
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('outside the run working directory')
  })

  it('blocks all tools when run is in done stage', async () => {
    const fixture = createFixture('done')
    await fixture.manager.initialize()

    expect(
      await fixture.manager.authorizeTool(fixture.run.id, 'Read', { file_path: 'test.ts' }),
    ).toEqual(expect.objectContaining({ allowed: false }))
  })

  it('blocks all tools when run has a terminal state', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()

    // Mark the run as failed
    fixture.context.runRepo.updateTerminalState(fixture.run.id, 'failed')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Read', {
      file_path: 'test.ts',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('run is failed')
  })

})

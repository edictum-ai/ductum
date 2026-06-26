import { afterEach, createFixture, createRun, createTask, createTempGitWorktree, describe, expect, fs, gitFixtureTimeoutMs, it } from './shared.js'

describe('PostCompletionRouter task verification fallback', () => {
  let tempRoot: string | null = null

  afterEach(() => {
    if (tempRoot != null) fs.rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = null
  })

  it('uses task verification commands when workflow verification is not configured', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const temp = createTempGitWorktree()
    tempRoot = temp.root
    const task = createTask(fixture, {
      name: 'P1',
      verification: ['test -f feature.txt'],
    })
    const run = createRun(fixture, task, { worktreePaths: [temp.worktree] })

    await fixture.router.runImplCompletion(run)

    const snapshot = fixture.ctx.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.snapshot')
    expect(snapshot?.payload).toMatchObject({
      kind: 'worktree.snapshot',
      verifyOutput: {
        command: 'test -f feature.txt',
        exitCode: 0,
      },
    })
    expect(snapshot?.payload.verifyOutput).toMatchObject({
      tail: expect.stringContaining('$ test -f feature.txt'),
    })
  }, gitFixtureTimeoutMs)

  it('keeps workflow profile verification as the higher-priority source', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: (_projectName, profile) => profile?.verifyCommands ?? [],
        resolveReviewerAgent: () => null,
      },
    })
    const temp = createTempGitWorktree()
    tempRoot = temp.root
    fs.writeFileSync(`${temp.worktree}/workflow.txt`, 'workflow\n')
    const task = createTask(fixture, {
      name: 'P1',
      verification: ['test -f feature.txt'],
    })
    const run = createRun(fixture, task, {
      worktreePaths: [temp.worktree],
      runtimeWorkflowProfile: {
        id: 'profile-1' as never,
        name: 'default',
        projectId: fixture.spec.projectId,
        path: '.ductum/workflow.md',
        verifyCommands: ['test -f workflow.txt'],
      },
    })

    await fixture.router.runImplCompletion(run)

    const snapshot = fixture.ctx.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.snapshot')
    expect(snapshot?.payload).toMatchObject({
      kind: 'worktree.snapshot',
      verifyOutput: {
        command: 'test -f workflow.txt',
        exitCode: 0,
      },
    })
  }, gitFixtureTimeoutMs)

  it('records the executed task-level command in the snapshot when multiple fallback commands run', async () => {
    const verificationResults: unknown[] = []
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
        onVerificationResult: (_runId, result) => { verificationResults.push(result) },
      },
    })
    const temp = createTempGitWorktree()
    tempRoot = temp.root
    fs.writeFileSync(`${temp.worktree}/second.txt`, 'second\n')
    const task = createTask(fixture, {
      name: 'P1',
      verification: ['test -f feature.txt', 'test -f second.txt'],
    })
    const run = createRun(fixture, task, { worktreePaths: [temp.worktree] })

    await fixture.router.runImplCompletion(run)

    const snapshot = fixture.ctx.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.snapshot')
    expect(snapshot?.payload).toMatchObject({
      kind: 'worktree.snapshot',
      verifyOutput: {
        command: 'test -f second.txt',
        exitCode: 0,
      },
    })
    expect(snapshot?.payload.verifyOutput).toMatchObject({
      tail: expect.stringContaining('$ test -f second.txt'),
    })
    expect(verificationResults).toMatchObject([
      expect.objectContaining({
        passed: true,
        commands: [
          expect.objectContaining({ command: 'test -f feature.txt', passed: true }),
          expect.objectContaining({ command: 'test -f second.txt', passed: true }),
        ],
      }),
    ])
  }, gitFixtureTimeoutMs)

  it('routes failed task-level verification into the existing verification-fix path', async () => {
    const fixture = createFixture({
      postCompletion: {
        resolveVerifyCommands: () => [],
        resolveReviewerAgent: () => null,
      },
    })
    const temp = createTempGitWorktree()
    tempRoot = temp.root
    const task = createTask(fixture, {
      name: 'P1',
      status: 'active',
      verification: ['false'],
    })
    const run = createRun(fixture, task, { worktreePaths: [temp.worktree] })

    await fixture.router.runImplCompletion(run)

    const snapshot = fixture.ctx.evidenceRepo.list(run.id).find((item) => item.payload.kind === 'worktree.snapshot')
    expect(snapshot?.payload).toMatchObject({
      kind: 'worktree.snapshot',
      verifyOutput: {
        command: 'false',
        exitCode: 1,
      },
    })
    expect(fixture.ctx.taskRepo.list(fixture.spec.id).some((item) => item.name.startsWith('fix-P1-r1'))).toBe(true)
  }, gitFixtureTimeoutMs)
})

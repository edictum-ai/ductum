import { join } from 'node:path'

import { createFixture, createId, createTask, describe, expect, it, vi, type WorktreeManager } from './shared.js'

describe('dispatcher target workdir resolution', () => {
  it('uses an absolute target repo path as the base worktree path', async () => {
    const baseRepo = '/Users/acartagena/project/qratum'
    const worktreePath = join(baseRepo, '.ductum-test-worktree')
    const worktreeManager = {
      enabled: true,
      cleanupOnSuccess: true,
      cleanupOnFailure: true,
      isGitRepo: vi.fn(() => true),
      create: vi.fn(async () => worktreePath),
      remove: vi.fn(async () => undefined),
      cleanupStale: vi.fn(async () => 0),
    } as unknown as WorktreeManager
    const fixture = createFixture({ worktreeManager })
    const task = createTask(fixture, {
      assignedAgentId: fixture.builder.id,
      repos: [baseRepo],
      status: 'ready',
    })

    const run = await fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)

    expect(worktreeManager.create).toHaveBeenCalledWith(
      baseRepo,
      task.name,
      run.id,
      fixture.project.name,
      undefined,
    )
    expect(fixture.context.runRepo.get(run.id)?.worktreePaths).toEqual([worktreePath])
    expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledWith(
      expect.anything(),
      task,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ workingDir: worktreePath }),
    )
  })

  it('uses the scoped repository path before legacy task repos for sandbox worktrees', async () => {
    const scaffoldRepo = '/tmp/ductum-factory-scaffold'
    const qratumRepo = '/Users/acartagena/project/qratum'
    const worktreePath = join(qratumRepo, '.ductum-test-worktree')
    const worktreeManager = {
      enabled: true,
      cleanupOnSuccess: true,
      cleanupOnFailure: true,
      isGitRepo: vi.fn(() => true),
      create: vi.fn(async () => worktreePath),
      remove: vi.fn(async () => undefined),
      cleanupStale: vi.fn(async () => 0),
    } as unknown as WorktreeManager
    const fixture = createFixture({
      worktreeManager,
      resolveRepoPath: (repo) => repo === '.' ? scaffoldRepo : undefined,
      recordEvidence: true,
    })
    const repository = fixture.context.repositoryRepo.create({
      id: createId<'RepositoryId'>() as never,
      projectId: fixture.project.id,
      name: 'qratum',
      spec: { localPath: qratumRepo },
    })
    const sandbox = fixture.context.configResourceRepo.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'SandboxProfile',
      projectId: null,
      name: 'worktree-default',
      spec: { provider: 'host', mode: 'worktree', filesystem: { worktree: 'readWrite' } },
    })
    fixture.context.agentRepo.update(fixture.builder.id, {
      resourceRefs: { sandboxRef: sandbox.name },
    })
    const task = createTask(fixture, {
      assignedAgentId: fixture.builder.id,
      repositoryId: repository.id,
      repos: ['.'],
      status: 'ready',
    })

    const run = await fixture.dispatcher.manualDispatch(task.id, fixture.builder.id)

    expect(worktreeManager.create).toHaveBeenCalledWith(
      qratumRepo,
      task.name,
      run.id,
      fixture.project.name,
      undefined,
    )
    expect(worktreeManager.create).not.toHaveBeenCalledWith(
      scaffoldRepo,
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.anything(),
    )
    expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledWith(
      expect.anything(),
      task,
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ workingDir: worktreePath }),
    )
  })
})

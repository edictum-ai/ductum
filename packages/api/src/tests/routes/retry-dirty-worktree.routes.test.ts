import { createFixture, createId, describe, execFileAsync, expect, it, join, mkdtemp, registerRouteTestCleanup, requestJson, rm, seedBase, tmpdir, writeFile, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - retry dirty worktree guard', () => {
  it('blocks retry when preserved partial files are still dirty', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    fixture.repos.tasks.updateStatus(task.id, 'failed')
    const repo = await mkdtemp(join(tmpdir(), 'ductum-retry-dirty-'))
    await execFileAsync('git', ['init', '-q', repo])
    await execFileAsync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'])
    await execFileAsync('git', ['-C', repo, 'config', 'user.name', 'Test'])
    await execFileAsync('mkdir', ['-p', join(repo, 'packages/core/src/repos')])
    await writeFile(join(repo, 'packages/core/src/db-migrations.ts'), 'export const migration = 1\n')
    await execFileAsync('git', ['-C', repo, 'add', 'packages/core/src/db-migrations.ts'])
    await execFileAsync('git', ['-C', repo, 'commit', '-qm', 'seed'])
    await writeFile(join(repo, 'packages/core/src/db-migrations.ts'), 'export const migration = 2\n')
    await writeFile(join(repo, 'packages/core/src/repos/task-dispatch-skip.ts'), 'export const dirty = true\n')
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'implement',
      terminalState: 'failed',
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'feat/dirty',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
      worktreePaths: [repo],
      ciStatus: null,
      reviewStatus: null,
      failReason: 'prompt_overflow',
      recoverable: false,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      lastHeartbeat: new Date().toISOString(),
      heartbeatTimeoutSeconds: 120,
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/retry`, { method: 'POST' })

    expect(result.response.status).toBe(400)
    expect(String((result.json as { error?: unknown }).error)).toContain('Retry blocked')
    expect(String((result.json as { error?: unknown }).error)).toContain('packages/core/src/db-migrations.ts')
    expect(String((result.json as { error?: unknown }).error)).toContain('packages/core/src/repos/task-dispatch-skip.ts')
    expect(fixture.repos.tasks.get(task.id)?.status).toBe('failed')
    await rm(repo, { recursive: true, force: true })
  })
})

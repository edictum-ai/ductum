import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createId, DEFAULT_WORKTREE_CONFIG, initDb, SqliteFactoryRepo, type Run } from '@ductum/core'

import { createFixture, requestJson, seedBase } from './helpers.js'

async function withTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ductum-ops-health-regression-'))
}

function seedRuntimeFactoryDb(dbPath: string): void {
  const db = initDb(dbPath)
  try {
    new SqliteFactoryRepo(db).create({
      id: createId(),
      name: 'Ductum',
      config: { heartbeatTimeoutSeconds: 120, defaultMergeMode: 'human' },
    })
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}

describe('ops health regression coverage', () => {
  it('blocks overall health when the configured database path is missing', async () => {
    const root = await withTempRoot()
    const fixture = await createFixture({
      runtime: { dbPath: join(root, 'missing.db') },
    })
    try {
      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      expect((res.json as any).database).toMatchObject({
        exists: false,
        factoryState: 'unknown',
      })
      expect((res.json as any).status).toBe('blocked')
    } finally {
      fixture.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks unreadable worktree directories inaccessible instead of reporting 0 B', async () => {
    const root = await withTempRoot()
    const dbPath = join(root, 'runtime.db')
    seedRuntimeFactoryDb(dbPath)
    const taskDir = join(root, 'ductum', 'p1-unreadable-AAAAAA')
    const filePath = join(taskDir, 'ductum', 'README.md')
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, '# unreadable\n')
    await chmod(taskDir, 0)
    const fixture = await createFixture({
      getDispatcherStatus: () => ({
        running: true,
        activeRuns: 0,
        maxConcurrentRuns: 1,
        lastCycleAt: null,
        enabled: true,
        adapterCount: 1,
        adapters: ['codex-sdk'],
        reason: null,
      }),
      runtime: {
        dbPath,
        worktreeEnabled: true,
        worktreeBasePath: root,
      },
    })
    try {
      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      const worktrees = (res.json as any).worktrees
      expect(worktrees.entries).toHaveLength(1)
      expect(worktrees.entries[0]).toMatchObject({
        exists: true,
        accessible: false,
        bytes: null,
        shortId: 'AAAAAA',
      })
      expect(worktrees.totalBytes).toBe(null)
      expect(worktrees.measurable).toBe(false)
      expect((res.json as any).status).toBe('degraded')
    } finally {
      fixture.close()
      await chmod(taskDir, 0o700).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the core default worktree base when dispatch is enabled without an explicit base path', async () => {
    const fixture = await createFixture({
      runtime: {
        dbPath: ':memory:',
        worktreeEnabled: true,
        worktreeBasePath: null,
      },
    })
    try {
      seedBase(fixture)
      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      const worktrees = (res.json as any).worktrees
      expect(worktrees.basePath).toBe(resolve(DEFAULT_WORKTREE_CONFIG.basePath))
      expect(worktrees.error).not.toMatch(/No worktree base path is configured/i)
    } finally {
      fixture.close()
    }
  })

  it('surfaces unreadable project directories as inaccessible inventory rows', async () => {
    const root = await withTempRoot()
    const projectDir = join(root, 'ductum')
    await mkdir(projectDir, { recursive: true })
    await chmod(projectDir, 0)
    const fixture = await createFixture({
      runtime: {
        dbPath: ':memory:',
        worktreeEnabled: true,
        worktreeBasePath: root,
      },
    })
    try {
      seedBase(fixture)
      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      const worktrees = (res.json as any).worktrees
      expect(worktrees.error).toMatch(/project directory unreadable/i)
      expect(worktrees.entries).toHaveLength(1)
      expect(worktrees.entries[0]).toMatchObject({
        path: projectDir,
        project: 'ductum',
        taskDir: '(project directory unreadable)',
        accessible: false,
        bytes: null,
      })
      expect(worktrees.measurable).toBe(false)
      expect(worktrees.totalBytes).toBe(null)
    } finally {
      fixture.close()
      await chmod(projectDir, 0o700).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports the real removed count when cleanup succeeds but final audit logging fails', async () => {
    let calls = 0
    const basePath = await withTempRoot()
    const fixture = await createFixture({
      cleanupWorktrees: async () => {
        calls += 1
        fixture.context.db.prepare('DROP TABLE audit_events').run()
        return 2
      },
      runtime: {
        dispatcherEnabled: true,
        worktreeEnabled: true,
        worktreeBasePath: basePath,
      },
    })
    try {
      seedBase(fixture)
      const res = await requestJson(fixture.app, '/api/factory/ops-health/cleanup-worktrees', {
        method: 'POST',
        body: { confirm: true },
      })

      expect(res.response.status).toBe(200)
      expect(calls).toBe(1)
      expect(res.json).toMatchObject({
        outcome: 'success',
        removed: 2,
        reason: expect.stringMatching(/audit logging failed/i),
      })
    } finally {
      fixture.close()
      await rm(basePath, { recursive: true, force: true })
    }
  })

  it('includes SQLite WAL and SHM sidecars in database storage size', async () => {
    const root = await withTempRoot()
    const dbPath = join(root, 'ductum.db')
    await writeFile(dbPath, 'a'.repeat(100))
    await writeFile(`${dbPath}-wal`, 'b'.repeat(40))
    await writeFile(`${dbPath}-shm`, 'c'.repeat(20))
    const fixture = await createFixture({
      runtime: { dbPath },
    })
    try {
      seedBase(fixture)
      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      expect((res.json as any).database.sizeBytes).toBe(160)
    } finally {
      fixture.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('counts persisted active runs when dispatcher status support is unavailable', async () => {
    const fixture = await createFixture({
      getDispatcherStatus: undefined,
      runtime: { dbPath: ':memory:' },
    })
    try {
      const { task, builder } = seedBase(fixture)
      createActiveRun(fixture, task.id, builder.id)

      const res = await requestJson(fixture.app, '/api/factory/ops-health')

      expect(res.response.status).toBe(200)
      expect((res.json as any).process.dispatcher).toMatchObject({
        enabled: false,
        running: false,
        activeRuns: 1,
        reason: 'dispatcher support not loaded',
      })
    } finally {
      fixture.close()
    }
  })
})

function createActiveRun(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  taskId: Run['taskId'],
  agentId: Run['agentId'],
): Run {
  return fixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'stale-session',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
}

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let tempRoots: string[] = []

afterEach(() => {
  fixture?.close()
  fixture = undefined
  for (const root of tempRoots.splice(0)) {
    rm(root, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function withTempWorktreeBase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ductum-ops-health-'))
  tempRoots.push(root)
  return root
}

async function populateWorktree(basePath: string, project: string, taskSlug: string, files: Array<{ path: string; contents: string }>) {
  const taskDir = join(basePath, project, taskSlug)
  await mkdir(taskDir, { recursive: true })
  for (const file of files) {
    const filePath = join(taskDir, file.path)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, file.contents)
  }
  return taskDir
}

describe('GET /api/factory/ops-health', () => {
  it('reports worktree inventory with disk byte estimates and an explicit unavailable state when disabled', async () => {
    const enabledBase = await withTempWorktreeBase()
    await populateWorktree(enabledBase, 'ductum', 'p1-ops-AAAAAA', [
      { path: 'ductum/README.md', contents: '# ductum\n' },
      { path: 'ductum/package.json', contents: '{"name":"ductum"}' },
    ])
    await populateWorktree(enabledBase, 'ductum', 'p2-other-BBBBBB', [
      { path: 'ductum/index.ts', contents: 'export const x = 1\n' },
    ])

    fixture = await createFixture({
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
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
        publicApiUrl: null,
        dashboardUrl: 'http://127.0.0.1:4100',
        dbPath: ':memory:',
        factoryDataDir: enabledBase,
        worktreeEnabled: true,
        worktreeBasePath: enabledBase,
      },
    })
    seedBase(fixture)

    const enabled = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(enabled.response.status).toBe(200)
    expect(enabled.json).toMatchObject({
      process: expect.objectContaining({
        apiBindHost: '127.0.0.1',
        apiPort: 4100,
        dispatcher: expect.objectContaining({ enabled: true, running: true }),
      }),
    })
    const worktrees = (enabled.json as any).worktrees
    expect(worktrees).toMatchObject({
      enabled: true,
      basePath: enabledBase,
      measurable: true,
      directoryCount: 2,
      error: null,
    })
    expect(worktrees.totalBytes).toBeGreaterThan(0)
    expect(workentriesHave(worktrees, 'ductum', 'p1-ops-AAAAAA')).toBe(true)
    const first = worktrees.entries[0]
    expect(first.bytes).toBeGreaterThan(0)
    expect(first.exists).toBe(true)
    expect(first.accessible).toBe(true)
    expect(first.shortId).toBe('AAAAAA')

    // Now flip worktrees off — the report must surface an explicit
    // unavailable reason, not an empty list with a zero byte count.
    fixture.close()
    fixture = undefined
    fixture = await createFixture({
      runtime: {
        dbPath: ':memory:',
        worktreeEnabled: false,
        worktreeBasePath: enabledBase,
      },
    })
    seedBase(fixture)
    const disabled = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(disabled.response.status).toBe(200)
    expect((disabled.json as any).worktrees).toMatchObject({
      enabled: false,
      measurable: false,
      directoryCount: 0,
      totalBytes: null,
      entries: [],
    })
    expect((disabled.json as any).worktrees.error).toMatch(/disabled/i)
  })

  it('surfaces an unavailable worktree state when the configured base path does not exist', async () => {
    const base = await withTempWorktreeBase()
    const ghostBase = join(base, 'missing-base')

    fixture = await createFixture({
      runtime: {
        dbPath: ':memory:',
        worktreeEnabled: true,
        worktreeBasePath: ghostBase,
      },
    })
    seedBase(fixture)

    const res = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(res.response.status).toBe(200)
    const worktrees = (res.json as any).worktrees
    expect(worktrees).toMatchObject({
      enabled: true,
      measurable: false,
      directoryCount: 0,
      totalBytes: null,
      entries: [],
    })
    expect(worktrees.error).toMatch(/does not exist/i)
  })

  it('exposes DB schema status with binary vs applied schema versions and an explicit backup-unavailable state', async () => {
    // Use a real on-disk SQLite file so exists/size/factory-state are honest.
    const dbPath = join(await withTempWorktreeBase(), 'ops-health.db')
    // Touch the file so existsSync reports true; the fixture still opens
    // its own :memory: DB, but the schema probe uses context.db directly.
    await writeFile(dbPath, 'x'.repeat(512), 'utf8')

    fixture = await createFixture({
      runtime: { dbPath },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(res.response.status).toBe(200)
    const database = (res.json as any).database
    expect(database.path).toBe(dbPath)
    expect(database.exists).toBe(true)
    expect(database.sizeBytes).toBeGreaterThanOrEqual(512)
    expect(database.schema.unavailable).toBeFalsy()
    expect(database.schema.binarySchemaVersion).toBe(database.schema.appliedSchemaVersion)
    expect(database.schema.unknownMigrationIds).toEqual([])
    expect(database.schema.current).toBe(true)
    expect(database.schema.headMigrationId).not.toBe(null)
    expect(database.schema.appliedMigrationIds.length).toBeGreaterThan(0)
    expect(database.backupRestore).toEqual({
      available: false,
      reason: expect.stringMatching(/No backup\/restore primitive/),
    })
  })

  it('reports DB schema as unavailable when the runtime hides the db path', async () => {
    fixture = await createFixture({
      runtime: { dbPath: undefined as unknown as string },
    })
    seedBase(fixture)
    const res = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(res.response.status).toBe(200)
    const database = (res.json as any).database
    expect(database.path).toBe(null)
    expect(database.exists).toBe(false)
    expect(database.schema).toMatchObject({
      unavailable: true,
      reason: expect.stringMatching(/Database path is not exposed/),
    })
  })

  it('surfaces recent audit log entries under logs, never as a blank card', async () => {
    fixture = await createFixture({
      runtime: { dbPath: ':memory:' },
    })
    const seeded = seedBase(fixture)
    // Seed a few audit events so the recent-logs card has something to show.
    fixture.context.db
      .prepare(`INSERT INTO audit_events (id, event_type, status, title, occurred_at) VALUES (?, ?, ?, ?, ?)`)
      .run('evt-1', 'ops.cleanup_worktrees', 'success', 'Worktree cleanup completed', new Date().toISOString())
    void seeded

    const res = await requestJson(fixture.app, '/api/factory/ops-health')
    expect(res.response.status).toBe(200)
    const logs = (res.json as any).logs
    expect(logs.available).toBe(true)
    expect(Array.isArray(logs.recent)).toBe(true)
    expect(logs.recent.length).toBeGreaterThan(0)
    expect(logs.recent[0].title).toBe('Worktree cleanup completed')
  })
})

function workentriesHave(worktrees: { entries: any[] }, project: string, taskDir: string): boolean {
  return worktrees.entries.some((entry) => entry.project === project && entry.taskDir === taskDir)
}

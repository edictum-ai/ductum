import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, seedInitialFactoryDatabase, SqliteFactoryRuntimeSettingsRepo } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { loadPersistedServeConfig } from '../serve/db-config.js'
import { runCommand } from './helpers.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('start command', () => {
  it('defaults ductum start to the per-Factory data directory under ~/.ductum', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-start-home-'))
    tmpDirs.push(home)
    const dir = join(home, '.ductum', 'factories', 'default')
    await factoryDirAt(dir)
    const result = await runCommand(['start', '--dry-run', '--json'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.text) as { kind: string; data: Record<string, unknown> }
    expect(envelope.kind).toBe('start.plan')
    expect(envelope.data).toMatchObject({
      command: 'start',
      factoryDir: dir,
      dbPath: join(dir, 'ductum.db'),
    })
    expect(envelope.data).not.toHaveProperty('configPath')
    expect(envelope.data).not.toHaveProperty('factoryState')
  })

  it('discovers a single existing nested Factory when --dir is omitted', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-start-discovery-home-'))
    tmpDirs.push(home)
    const dir = join(home, '.ductum', 'factories', 'dogfood', 'ductum')
    await factoryDirAt(dir)

    const result = await runCommand(['start', '--dry-run', '--json'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text).data).toMatchObject({ factoryDir: dir })
  })

  it('requires --dir when multiple nested factories are discoverable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-start-multi-home-'))
    tmpDirs.push(home)
    const first = join(home, '.ductum', 'factories', 'one', 'ductum')
    const second = join(home, '.ductum', 'factories', 'two', 'ductum')
    await factoryDirAt(first)
    await factoryDirAt(second)

    const result = await runCommand(['start', '--dry-run'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Multiple Ductum factories found. Use --dir to choose one:')
    expect(result.errorText).toContain(first)
    expect(result.errorText).toContain(second)
  })

  it('prints a loopback start plan for an initialized factory without rewriting its token file', async () => {
    const dir = await factoryDir()
    const result = await runCommand(['start', '--dir', dir, '--dry-run', '--json'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    const envelope = JSON.parse(result.text) as { kind: string; data: Record<string, unknown> }
    expect(envelope.kind).toBe('start.plan')
    expect(envelope.data).toMatchObject({
      command: 'start',
      factoryDir: dir,
      dbPath: join(dir, 'ductum.db'),
      apiUrl: 'http://127.0.0.1:4100',
      host: '127.0.0.1',
      dispatch: true,
      tokenDetectEnabled: false,
      browserHandoffEnabled: true,
    })
    expect(await readFile(join(dir, '.env.local'), 'utf8')).toBe('DUCTUM_OPERATOR_TOKEN=existing-token\n')
  })

  it('renders a DB-only start plan in human output', async () => {
    const dir = await factoryDir()
    const result = await runCommand(['--human', 'start', '--dir', dir, '--dry-run'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(result.text).toContain('using DB-backed Factory data')
    expect(result.text).toContain('browser handoff: enabled for local auto-open')
    expect(result.text).toContain(join(dir, 'ductum.db'))
    expect(result.text).not.toContain('ductum.yaml')
  })

  it('keeps DB-backed startup authoritative even when a stale ductum.yaml is present', async () => {
    const dir = await factoryDir()
    await writeFile(join(dir, 'ductum.yaml'), 'factory:\n  migratedAt: tampered\n', 'utf8')

    const result = await runCommand(['start', '--dir', dir, '--dry-run', '--json'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text).data).toMatchObject({
      command: 'start',
      factoryDir: dir,
      dbPath: join(dir, 'ductum.db'),
    })
  })

  it('exposes token-detect only by explicit opt-in', async () => {
    const dir = await factoryDir()
    const result = await runCommand(['start', '--dir', dir, '--allow-token-detect', '--dry-run', '--json'])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text).data).toMatchObject({
      command: 'start',
      tokenDetectEnabled: true,
    })
  })

  it('can read an existing operator token from the operator home directory', async () => {
    const dir = await factoryDir({ envFile: false })
    const home = await mkdtemp(join(tmpdir(), 'ductum-start-token-home-'))
    tmpDirs.push(home)
    await mkdir(join(home, '.ductum'), { recursive: true })
    await writeFile(join(home, '.ductum', 'operator-token'), 'home-token\n')
    const result = await runCommand(['start', '--dir', dir, '--dry-run', '--json'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text)).toMatchObject({ kind: 'start.plan' })
  })

  it('uses the persisted Factory port when no flag or env overrides it', async () => {
    const dir = await emptyDir()
    await writeFile(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=existing-token\n')
    const db = initDb(join(dir, 'ductum.db'))
    seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'factory', agents: [] })
    db.close()

    const result = await runCommand(['start', '--dir', dir, '--dry-run', '--json'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text).data).toMatchObject({
      command: 'start',
      port: 4100,
      dbPath: join(dir, 'ductum.db'),
    })
  })

  it('uses persisted runtime host, port, and dispatcher enabled state in the start plan', async () => {
    const dir = await emptyDir()
    await writeFile(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=existing-token\n')
    const db = initDb(join(dir, 'ductum.db'))
    const seeded = seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'factory', agents: [] })
    new SqliteFactoryRuntimeSettingsRepo(db).upsert(seeded.factory.id, {
      apiBindHost: 'localhost',
      apiPort: 4777,
      dispatcherEnabled: false,
      dashboardUrl: 'http://localhost:4777',
    })
    db.close()

    const result = await runCommand(['start', '--dir', dir, '--dry-run', '--json'], undefined, '', {
      env: { HOME: tmpdir(), PATH: '/bin' },
    })

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text).data).toMatchObject({
      command: 'start',
      apiUrl: 'http://localhost:4777',
      host: 'localhost',
      port: 4777,
      dispatch: false,
    })
  })

  it('loads API runtime inputs from persisted Factory DB state', async () => {
    const dir = await emptyDir()
    const db = initDb(join(dir, 'ductum.db'))
    seedInitialFactoryDatabase({
      db,
      factoryDir: dir,
      projectName: 'factory',
      agents: ['anthropic', 'codex'],
    })
    db.close()

    const config = loadPersistedServeConfig(join(dir, 'ductum.db'), dir)

    expect(config.apiPort).toBe(4100)
    expect(config.apiBindHost).toBe('127.0.0.1')
    expect(config.dispatcherEnabled).toBe(true)
    expect(config.dashboardUrl).toBeNull()
    expect(config.agentsConfig).toMatchObject({
      'claude-builder': { harness: 'claude-agent-sdk' },
      'claude-reviewer': { harness: 'claude-agent-sdk' },
      'codex-builder': { harness: 'codex-sdk' },
    })
    expect(config.repoPathMap).toMatchObject({ '.': dir })
    expect(config.worktreeConfig).toMatchObject({
      enabled: true,
      basePath: join(dir, '.ductum', 'worktrees'),
    })
    expect(config.costBudget).toEqual({ perSpecHardUsd: 200 })
  })

  it('routes missing Factory state to fresh setup guidance without migration commands', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ductum-start-missing-home-'))
    tmpDirs.push(home)
    const result = await runCommand(['start', '--dry-run'], undefined, '', {
      env: { HOME: home, PATH: '/bin' },
    })

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('No Factory setup found for ductum start')
    expect(result.errorText).toContain('Next setup action: ductum init')
    expect(result.errorText).not.toContain('migrate-legacy')
  })

  it('refuses startup state outside the Factory data directory boundary', async () => {
    const dir = await factoryDir()
    const result = await runCommand(['start', '--dir', dir, '--db', '../outside.db', '--dry-run'])

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('--db must stay inside the Factory data directory')
  })

})

async function factoryDir(options: { envFile?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-start-test-'))
  tmpDirs.push(dir)
  await factoryDirAt(dir, options)
  return dir
}

async function factoryDirAt(dir: string, options: { envFile?: boolean } = {}): Promise<void> {
  await mkdir(dir, { recursive: true })
  const db = initDb(join(dir, 'ductum.db'))
  seedInitialFactoryDatabase({ db, factoryDir: dir, projectName: 'factory', agents: [] })
  db.close()
  if (options.envFile !== false) {
    await writeFile(join(dir, '.env.local'), 'DUCTUM_OPERATOR_TOKEN=existing-token\n')
  }
}

async function emptyDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-start-test-'))
  tmpDirs.push(dir)
  return dir
}

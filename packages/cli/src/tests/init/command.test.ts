import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb, seedInitialFactoryDatabase, SqliteFactoryRepo } from '@ductum/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { INIT_EVENT_KINDS } from '../../init/events.js'
import { createMockApi, runCommand } from '../helpers.js'

const tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('init command', () => {
  it('renders help through the output envelope helper', async () => {
    const result = await runCommand(['init', '--help'])

    expect(result.code).toBe(0)
    expect(JSON.parse(result.text)).toMatchObject({
      schemaVersion: 1,
      kind: 'cli.help',
      data: {
        command: 'ductum init',
        usage: 'ductum init [options]',
        options: expect.arrayContaining([
          expect.objectContaining({ flags: '--dir <path>' }),
          expect.objectContaining({ flags: '--name <projectName>' }),
          expect.objectContaining({ flags: '--no-git' }),
        ]),
      },
    })
  })

  it('uses the external default factory data dir in non-interactive mode', async () => {
    const root = await tempDir()
    const runProcess = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
    const result = await runCommand([
      '--json',
      'init',
      '--no-git',
      '--no-login',
      '--no-browser',
    ], createMockApi(), '', { env: { HOME: root }, runProcess, initHandoff: { run: fakeHandoff } })

    expect(result.code).toBe(0)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    expect(envelopes[0]).toMatchObject({
      kind: 'init.started',
      data: { projectName: 'default' },
    })
    expect(existsSync(join(root, '.ductum', 'factories', 'default', 'ductum.db'))).toBe(true)
  })

  it('emits documented NDJSON envelopes and writes the scaffold', async () => {
    const root = await tempDir()
    const projectDir = join(root, 'factory')
    await mkdir(projectDir)
    const runProcess = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
    const result = await runCommand([
      '--json',
      'init',
      '--dir',
      root,
      '--name',
      'factory',
      '--no-git',
    ], createMockApi(), '', { env: { HOME: root }, runProcess, initHandoff: { run: fakeHandoff } })

    expect(result.code).toBe(0)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    expect(envelopes.map((item) => item.kind)).toEqual([
      'init.started',
      'init.directory_resolved',
      'init.auth_started',
      'init.auth_completed',
      'init.auth_codex_started',
      'init.auth_codex_skipped',
      'init.auth_copilot_started',
      'init.auth_copilot_skipped',
      'init.agents_selected',
      'init.scaffolded',
      'init.completed',
    ])
    for (const envelope of envelopes) {
      expect(envelope).toMatchObject({ schemaVersion: 1, ts: '2026-04-04T12:00:00.000Z' })
    }
    expect(INIT_EVENT_KINDS).toEqual(expect.arrayContaining(envelopes.map((item) => item.kind)))
    expect(existsSync(join(projectDir, 'ductum.yaml'))).toBe(false)
    const db = initDb(join(projectDir, 'ductum.db'))
    expect(new SqliteFactoryRepo(db).get()).toMatchObject({ name: 'factory' })
    db.close()
    expect(existsSync(join(projectDir, '.ductum'))).toBe(true)
    expect(envelopes.at(-1)?.data.nextSteps).toContain('Open http://127.0.0.1:4777/welcome')
    expect(runProcess).toHaveBeenCalledTimes(3)
    expect(runProcess).toHaveBeenCalledWith('git', [
      '-C',
      projectDir,
      'rev-parse',
      '--is-inside-work-tree',
    ], expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(runProcess).toHaveBeenCalledWith('codex', ['login', 'status'], expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(runProcess).toHaveBeenCalledWith('gh', ['auth', 'status', '--hostname', 'github.com'], expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('omits pair=undefined from structured next steps when no pairing URL is available', async () => {
    const root = await tempDir()
    const runProcess = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
    const result = await runCommand([
      '--json',
      'init',
      '--dir',
      root,
      '--name',
      'factory',
      '--no-git',
      '--no-login',
      '--no-browser',
    ], createMockApi(), '', {
      env: { HOME: root },
      runProcess,
      initHandoff: { run: fakeHandoffWithoutPairingUrl },
    })

    expect(result.code).toBe(0)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    const completed = envelopes.find((item) => item.kind === 'init.completed')
    expect(completed?.data.nextSteps).toContain('Open http://127.0.0.1:4777/welcome')
    expect(completed?.data.nextSteps.join('\n')).not.toContain('pair=undefined')
  })

  it('prints CLI auth in structured next steps when an opened dashboard is unpaired', async () => {
    const root = await tempDir()
    const runProcess = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
    const result = await runCommand([
      '--json',
      'init',
      '--dir',
      root,
      '--name',
      'factory',
      '--no-git',
      '--no-login',
    ], createMockApi(), '', {
      env: { HOME: root },
      runProcess,
      initHandoff: { run: fakeOpenedHandoffWithoutPairingUrl },
    })

    expect(result.code).toBe(0)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    const completed = envelopes.find((item) => item.kind === 'init.completed')
    const nextSteps = completed?.data.nextSteps.join('\n')
    expect(nextSteps).toContain('Open http://127.0.0.1:4777/welcome')
    expect(nextSteps).toContain('export DUCTUM_OPERATOR_TOKEN="$(cat ')
    expect(nextSteps).toContain('ductum status --api-url http://127.0.0.1:4777')
    expect(nextSteps).not.toContain('pair=undefined')
  })

  it('returns init_already_initialized with the suggested start command', async () => {
    const root = await tempDir()
    const projectDir = join(root, 'factory')
    await scaffoldFixture(projectDir)

    const result = await runCommand([
      '--json',
      'init',
      '--dir',
      root,
      '--name',
      'factory',
    ], createMockApi(), '', { runProcess: vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: '' }) })

    expect(result.code).toBe(1)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    expect(envelopes.map((item) => item.kind)).toEqual(['init.started', 'error'])
    const error = envelopes.at(-1) ?? {}
    expect(error.data).toMatchObject({
      code: 'init_already_initialized',
      suggestedActions: [{ cmd: `ductum start --dir ${projectDir}` }],
    })
  })

  it('emits init.cancelled and rolls back when SIGINT lands during structured scaffold', async () => {
    const root = await tempDir()
    const runProcess = vi.fn().mockImplementation(async (_command: string, args: string[] = []) => {
      if (args.includes('commit')) process.emit('SIGINT')
      return args.includes('commit')
        ? { code: 130, stdout: '', stderr: 'interrupted' }
        : { code: 0, stdout: '', stderr: '' }
    })

    const result = await runCommand([
      '--json',
      'init',
      '--dir',
      root,
      '--name',
      'factory',
    ], createMockApi(), '', { env: { HOME: root }, runProcess })

    expect(result.code).toBe(130)
    const envelopes = result.text.trim().split('\n').map((line) => JSON.parse(line))
    expect(envelopes.at(-1)).toMatchObject({
      kind: 'init.cancelled',
      data: { reason: 'sigint' },
    })
    expect(existsSync(join(root, 'factory'))).toBe(false)
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-command-'))
  tmpDirs.push(dir)
  return dir
}

async function fakeHandoff() {
  return {
    apiUrl: 'http://127.0.0.1:4777',
    dashboardUrl: 'http://127.0.0.1:4777/welcome',
    handoffUrl: 'http://127.0.0.1:4777/welcome?pair=test-handoff',
    browserOpened: true,
    browserSkippedReason: null,
    tokenPath: '/tmp/factory/.ductum/operator-token',
    envPath: '/tmp/factory/.env.local',
    logPath: '/tmp/factory/.ductum/logs/api.log',
    apiPid: 123,
    seededAgents: 0,
    skippedAgents: [],
  }
}

async function fakeHandoffWithoutPairingUrl() {
  return {
    apiUrl: 'http://127.0.0.1:4777',
    dashboardUrl: 'http://127.0.0.1:4777/welcome',
    handoffUrl: null,
    browserOpened: false,
    browserSkippedReason: 'flag',
    tokenPath: '/tmp/factory/.ductum/operator-token',
    envPath: '/tmp/factory/.env.local',
    logPath: '/tmp/factory/.ductum/logs/api.log',
    apiPid: 123,
    seededAgents: 0,
    skippedAgents: [],
  }
}

async function fakeOpenedHandoffWithoutPairingUrl() {
  return {
    ...(await fakeHandoffWithoutPairingUrl()),
    browserOpened: true,
    browserSkippedReason: null,
  }
}

async function scaffoldFixture(projectDir: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(projectDir, { recursive: true })
  const db = initDb(join(projectDir, 'ductum.db'))
  seedInitialFactoryDatabase({ db, factoryDir: projectDir, projectName: 'factory' })
  db.close()
}

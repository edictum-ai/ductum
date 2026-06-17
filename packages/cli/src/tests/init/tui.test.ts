import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { initDb, SqliteAgentRepo, SqliteFactoryRepo } from '@ductum/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clack = vi.hoisted(() => {
  const cancelToken = Symbol('cancel')
  return {
    cancelToken,
    intro: vi.fn(),
    note: vi.fn(),
    text: vi.fn(),
    confirm: vi.fn(),
    multiselect: vi.fn(),
    outro: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn() })),
    isCancel: vi.fn((value: unknown) => value === cancelToken),
  }
})

vi.mock('@clack/prompts', () => clack)

import { createMockApi, runCommand } from '../helpers.js'

const tmpDirs: string[] = []

beforeEach(() => {
  for (const fn of [clack.intro, clack.note, clack.text, clack.confirm, clack.multiselect, clack.outro, clack.spinner, clack.isCancel]) fn.mockClear()
})

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('init TUI', () => {
  it('walks the four human prompts and writes the scaffold after confirmation', async () => {
    const root = await tempDir()
    const stdout = new TtyMemoryWritable()
    clack.text
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce('factory')
    clack.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)

    const result = await runCommand(['--human', 'init', '--no-git'], createMockApi(), '', {
      env: { HOME: root },
      stdout,
      runProcess: cleanGit(),
      initHandoff: { run: fakeHandoff },
    })

    expect(result.code).toBe(0)
    expect(clack.intro).toHaveBeenCalledWith('ductum init', expect.any(Object))
    expect(clack.text).toHaveBeenCalledTimes(3)
    expect(clack.confirm).toHaveBeenCalledTimes(4)
    expect(clack.outro.mock.calls[0]?.[0]).toContain(`cd ${join(root, 'factory')}`)
    expect(clack.outro.mock.calls[0]?.[0]).toContain('Open http://127.0.0.1:4777/welcome')
    expect(existsSync(join(root, 'factory', 'ductum.yaml'))).toBe(false)
    const db = initDb(join(root, 'factory', 'ductum.db'))
    expect(new SqliteFactoryRepo(db).get()).toMatchObject({ name: 'factory' })
    expect(new SqliteAgentRepo(db).list()).toEqual([])
    db.close()
  })

  it('emits init.cancelled and exits 130 when a prompt is cancelled', async () => {
    const root = await tempDir()
    const stdout = new TtyMemoryWritable()
    clack.text.mockResolvedValueOnce(clack.cancelToken)

    const result = await runCommand(['--human', 'init', '--dir', root, '--name', 'factory'], createMockApi(), '', {
      env: { HOME: root },
      stdout,
      runProcess: cleanGit(),
    })

    expect(result.code).toBe(130)
    expect(JSON.parse(stdout.text().trim())).toMatchObject({
      kind: 'init.cancelled',
      data: { reason: 'sigint' },
    })
    expect(existsSync(join(root, 'factory'))).toBe(false)
  })

  it('emits init.cancelled once and rolls back when SIGINT lands during scaffold', async () => {
    const root = await tempDir()
    const stdout = new TtyMemoryWritable()
    clack.text
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(root)
      .mockResolvedValueOnce('factory')
    clack.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    const runProcess = vi.fn().mockImplementation(async (_command: string, args: string[] = []) => {
      if (args.includes('status')) return { code: 1, stdout: '', stderr: 'not logged in' }
      if (args.includes('commit')) process.emit('SIGINT')
      return args.includes('commit')
        ? { code: 130, stdout: '', stderr: 'interrupted' }
        : { code: 0, stdout: '', stderr: '' }
    })

    const result = await runCommand(['--human', 'init'], createMockApi(), '', { env: { HOME: root }, stdout, runProcess })

    expect(result.code).toBe(130)
    expect(stdout.text().trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stdout.text().trim())).toMatchObject({
      kind: 'init.cancelled',
      data: { reason: 'sigint' },
    })
    expect(existsSync(join(root, 'factory'))).toBe(false)
  })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-tui-'))
  tmpDirs.push(dir)
  return dir
}

function cleanGit() {
  return vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'not a git repo' })
}

class TtyMemoryWritable extends Writable {
  isTTY = true
  private chunks: Buffer[] = []

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

async function fakeHandoff() {
  return {
    apiUrl: 'http://127.0.0.1:4777',
    dashboardUrl: 'http://127.0.0.1:4777/welcome',
    handoffUrl: 'http://127.0.0.1:4777/welcome?token=test-handoff',
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

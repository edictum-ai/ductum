import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { buildCodexLaunchEnv, spawnCodexAppServer } from '../codex-app-server-process.js'
import { createRun, createTask, jsonResponse } from './helpers.js'

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}))

class FakeCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = {
    write: vi.fn((chunk: string) => {
      for (const line of chunk.trim().split('\n').filter(Boolean)) {
        this.handleClientMessage(line)
      }
      return true
    }),
  }

  kill(): void {
    this.emit('exit', 0, null)
  }

  private handleClientMessage(line: string): void {
    const msg = JSON.parse(line) as { id?: number; method?: string }
    if (msg.id == null) return
    const result = msg.method === 'thread/start'
      ? { thread: { id: '019e50e2-445a-74f2-bd76-5fa295b701ea' } }
      : {}
    this.stdout.write(`${JSON.stringify({ id: msg.id, result })}\n`)
    if (msg.method === 'turn/start') {
      setImmediate(() => {
        this.stdout.write(`${JSON.stringify({ method: 'turn/completed' })}\n`)
        this.emit('exit', 0, null)
      })
    }
  }
}

class BrokenCodexProcess extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = {
    write: vi.fn(() => true),
  }

  kill(): void {
    this.emit('exit', 1, null)
  }
}

describe('CodexAppServerHarnessAdapter', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(jsonResponse({ activeStage: 'understand', stages: [] }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the Codex thread id for local cost scanning', async () => {
    const child = new FakeCodexProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const session = await adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )

    expect(session.harnessSessionId).toBe('019e50e2-445a-74f2-bd76-5fa295b701ea')
    await session.waitForCompletion()
  })

  it('rejects spawn when codex app-server cannot launch instead of crashing the API', async () => {
    const child = new BrokenCodexProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const adapter = new CodexAppServerHarnessAdapter('http://ductum.test')
    const spawned = adapter.spawn(
      createRun(),
      createTask(),
      'system prompt',
      {} as never,
      { workingDir: '/tmp/ductum-run' },
    )
    child.emit('error', new Error('spawn codex ENOENT'))

    await expect(spawned).rejects.toThrow('codex app-server failed to launch: spawn codex ENOENT')
  })

  it('adds common executable locations to the Codex launch PATH', () => {
    const env = buildCodexLaunchEnv('/tmp/ductum-run/repo', { PATH: '/custom/bin' } as NodeJS.ProcessEnv)

    expect(env.PATH?.split(':')).toEqual(expect.arrayContaining([
      '/custom/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ]))
  })

  it('honors an explicit Codex command override', () => {
    const child = new FakeCodexProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    spawnCodexAppServer('/tmp/ductum-run', {
      PATH: '/bin',
      DUCTUM_CODEX_COMMAND: '/custom/codex',
    } as NodeJS.ProcessEnv)

    expect(spawn).toHaveBeenCalledWith(
      '/custom/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({
        cwd: '/tmp/ductum-run',
        env: expect.objectContaining({
          CODEX_HOME: '/tmp/.codex-home/default',
          PATH: expect.stringContaining('/usr/local/bin'),
        }),
      }),
    )
  })

  it('launches Codex with an isolated home and copied auth pointer', () => {
    const sourceHome = mkdtempSync(join(tmpdir(), 'ductum-codex-source-'))
    const targetHome = mkdtempSync(join(tmpdir(), 'ductum-codex-target-'))
    writeFileSync(join(sourceHome, 'auth.json'), '{}')

    const env = buildCodexLaunchEnv('/tmp/ductum-run/repo', {
      PATH: '/bin',
      DUCTUM_RUN_ID: 'run/1',
      DUCTUM_CODEX_HOME: targetHome,
      DUCTUM_SOURCE_CODEX_HOME: sourceHome,
    } as NodeJS.ProcessEnv)

    expect(env.CODEX_HOME).toBe(targetHome)
    expect(env.PATH).toContain('/usr/local/bin')
    expect(existsSync(join(targetHome, 'config.toml'))).toBe(true)
    expect(existsSync(join(targetHome, 'auth.json'))).toBe(true)
  })
})

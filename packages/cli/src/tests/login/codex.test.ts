import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { detectExistingCodex, extractCodexAuthUrls, loginCodex, sanitizedEnv } from '../../login/codex.js'
import type { RunProcess } from '../../runtime.js'

afterEach(() => {
  vi.restoreAllMocks()
  spawnMock.mockReset()
})

describe('Codex login delegation', () => {
  it('sanitizes subprocess env to PATH, HOME, and TERM only', () => {
    expect(sanitizedEnv({
      PATH: '/bin',
      HOME: '/home/operator',
      TERM: 'xterm-256color',
      ANTHROPIC_API_KEY: 'anthropic-secret',
      OPENAI_API_KEY: 'openai-secret',
    })).toEqual({
      PATH: '/bin',
      HOME: '/home/operator',
      TERM: 'xterm-256color',
    })
  })

  it('runs codex login with explicit argv and captures stderr', async () => {
    const runProcess = vi.fn<RunProcess>().mockResolvedValue({ code: 0, stdout: 'ok', stderr: 'captured prompt' })

    const result = await loginCodex({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ANTHROPIC_API_KEY: 'secret' },
      runProcess,
    })

    expect(result).toEqual({ authenticated: true, source: 'codex login', stderrCaptured: true })
    expect(runProcess).toHaveBeenCalledWith('codex', ['login'], expect.objectContaining({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm' },
      timeoutMs: 15 * 60_000,
    }))
  })

  it('streams only vetted Codex auth URLs while capturing raw output', async () => {
    const child = fakeChild()
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.write('Open https://auth.openai.com/oauth/start?state=abc or https://evil.example.test/nope\n')
        child.stderr.write('Open http://localhost:1455 to continue\n')
        child.emit('close', 0)
      })
      return child
    })
    const urls: string[] = []

    const result = await loginCodex({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ANTHROPIC_API_KEY: 'secret' },
      onAuthUrl: (url) => urls.push(url),
    })

    expect(result).toEqual({ authenticated: true, source: 'codex login', stderrCaptured: true })
    expect(spawnMock).toHaveBeenCalledWith('codex', ['login'], {
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    expect(urls).toEqual([
      'https://auth.openai.com/oauth/start?state=abc',
      'http://localhost:1455',
    ])
  })

  it('turns non-zero codex login exits into a structured auth error source', async () => {
    const runProcess = vi.fn<RunProcess>().mockResolvedValue({ code: 7, stdout: '', stderr: 'failed without token' })

    await expect(loginCodex({ env: { PATH: '/bin', HOME: '/home/operator' }, runProcess }))
      .rejects.toMatchObject({ code: 'auth_codex_failed', exitCode: 7 })
  })

  it('detects OPENAI_API_KEY without spawning codex status', async () => {
    const runProcess = vi.fn<RunProcess>()

    await expect(detectExistingCodex({ env: { OPENAI_API_KEY: 'secret' }, runProcess }))
      .resolves.toEqual({ authenticated: true, source: 'OPENAI_API_KEY' })
    expect(runProcess).not.toHaveBeenCalled()
  })

  it('extracts auth URLs without allowing unrelated hosts', () => {
    expect(extractCodexAuthUrls([
      'https://chatgpt.com/auth',
      'https://sub.auth.openai.com/path,',
      'http://127.0.0.1:1455/callback.',
      'https://attacker.example/auth',
    ].join(' '))).toEqual([
      'https://chatgpt.com/auth',
      'https://sub.auth.openai.com/path',
      'http://127.0.0.1:1455/callback',
    ])
  })
})

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

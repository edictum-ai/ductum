import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

import { detectExistingCopilot, loginCopilotWithDeviceFlow } from '../../login/copilot.js'
import type { ProcessResult, RunProcess } from '../../runtime.js'

const tmpDirs: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  spawnMock.mockReset()
  const { rm } = await import('node:fs/promises')
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('Copilot device flow', () => {
  it('detects env and gh-managed credentials without exposing token values', async () => {
    const runProcess = vi.fn<RunProcess>()
    await expect(detectExistingCopilot({ env: { GH_TOKEN: 'secret-token' }, runProcess }))
      .resolves.toEqual({ authenticated: true, source: 'GH_TOKEN' })
    expect(runProcess).not.toHaveBeenCalled()

    const home = await tempDir()
    await mkdir(join(home, '.config', 'gh'), { recursive: true })
    await writeFile(join(home, '.config', 'gh', 'hosts.yml'), 'github.com:\n  user: octo\n', 'utf8')
    runProcess.mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
    await expect(detectExistingCopilot({ env: { HOME: home }, runProcess }))
      .resolves.toMatchObject({ authenticated: true, source: join(home, '.config', 'gh', 'hosts.yml') })
  })

  it('polls with server interval plus jitter and stores token through gh', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const sleeps: number[] = []
    const tokenRequests: string[] = []
    const runProcess = ghRunProcess()
    const storeToken = vi.fn(async (_token: string): Promise<ProcessResult> => ({ code: 0, stdout: '', stderr: '' }))
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      const body = String(init?.body)
      if (body.includes('scope=repo+read%3Aorg+gist')) {
        return json({ device_code: 'device-1', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 7 })
      }
      tokenRequests.push(body)
      return tokenRequests.length === 1 ? json({ error: 'authorization_pending' }) : json({ access_token: 'test-access-token', token_type: 'bearer' })
    })

    const result = await loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ANTHROPIC_API_KEY: 'secret' },
      runProcess,
      fetch: fetchFn,
      sleep: async (ms) => { sleeps.push(ms); now += ms },
      jitterMs: () => 123,
      storeToken,
      onDeviceCode: (prompt) => {
        expect(prompt).toEqual({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresInSeconds: 900 })
      },
    })

    expect(result).toEqual({ authenticated: true, source: 'gh auth status' })
    expect(sleeps).toEqual([7123, 7123])
    expect(tokenRequests.every((body) => body.includes('device_code=device-1'))).toBe(true)
    expect(storeToken).toHaveBeenCalledWith('test-access-token', expect.any(Object), undefined)
    expect(runProcess).toHaveBeenCalledWith('gh', ['--version'], expect.objectContaining({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm' },
    }))
  })

  it('handles slow_down by increasing the poll interval', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const sleeps: number[] = []
    let polls = 0
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-2', user_code: 'WXYZ-9876', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
      polls += 1
      return polls === 1 ? json({ error: 'slow_down' }) : json({ access_token: 'test-access-token-2' })
    })

    await loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async (ms) => { sleeps.push(ms); now += ms },
      jitterMs: () => 0,
      storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    expect(sleeps).toEqual([5000, 10000])
  })

  it('ignores malformed slow_down intervals instead of busy-looping', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const sleeps: number[] = []
    let polls = 0
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-slow', user_code: 'SLOW-DOWN', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
      polls += 1
      return polls === 1 ? json({ error: 'slow_down', interval: 'nope' }) : json({ access_token: 'test-access-token-slow' })
    })

    await loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async (ms) => { sleeps.push(ms); now += ms },
      jitterMs: () => 0,
      storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
    })

    expect(sleeps).toEqual([5000, 10000])
  })

  it('surfaces expired device codes distinctly', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-expired', user_code: 'EXPI-RED1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return json({ error: 'expired_token' })
    })

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async () => undefined,
      jitterMs: () => 0,
      storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
    })).rejects.toMatchObject({ code: 'auth_copilot_device_code_expired' })
  })

  it('enforces the 15 minute timeout and never persists device_code', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-timeout', user_code: 'TIME-OUT1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 })
      return json({ error: 'authorization_pending' })
    })
    const storeToken = vi.fn()

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async (ms) => { now += ms },
      jitterMs: () => 0,
      storeToken,
    })).rejects.toMatchObject({ code: 'auth_copilot_device_code_timeout' })

    expect(storeToken).not.toHaveBeenCalled()
  })

  it('requests a fresh device_code on each attempt', async () => {
    let counter = 0
    const seenDeviceCodes: string[] = []
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      const body = String(init?.body)
      if (body.includes('scope=')) {
        counter += 1
        return json({ device_code: `device-${counter}`, user_code: `CODE-${counter}`, verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      }
      seenDeviceCodes.push(new URLSearchParams(body).get('device_code') ?? '')
      return json({ access_token: `test-access-token-${counter}` })
    })
    const options = {
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async () => undefined,
      jitterMs: () => 0,
      storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
    }

    await loginCopilotWithDeviceFlow(options)
    await loginCopilotWithDeviceFlow(options)

    expect(seenDeviceCodes).toEqual(['device-1', 'device-2'])
  })

  it('fails before OAuth when gh is unavailable', async () => {
    const runProcess = vi.fn<RunProcess>().mockResolvedValue({ code: 127, stdout: '', stderr: 'missing gh' })

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess,
      fetch: vi.fn(),
    })).rejects.toMatchObject({ code: 'auth_copilot_gh_not_installed' })
  })

  it('does not include the token in storage failure errors', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-3', user_code: 'NOLE-AK1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return json({ access_token: 'test-super-secret' })
    })

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async () => undefined,
      jitterMs: () => 0,
      storeToken: async () => ({ code: 1, stdout: '', stderr: 'storage failed for redacted token' }),
    })).rejects.not.toThrow('test-super-secret')
  })

  it('maps non-json GitHub polling failures to structured errors', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-4', user_code: 'JSON-FAIL', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return new Response('<html>nope</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    })

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async () => undefined,
      jitterMs: () => 0,
      storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
    })).rejects.toMatchObject({ code: 'auth_copilot_failed' })
  })

  it('stores tokens through gh auth login with sanitized env and captured streams', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const child = fakeChild()
    let stdin = ''
    child.stdin.on('data', (chunk) => { stdin += chunk.toString() })
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        child.stdout.end('stored\n')
        child.stderr.end('captured\n')
        child.emit('close', 0)
      })
      return child
    })
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device-store', user_code: 'GHST-ORE1', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return json({ access_token: 'test-store-token' })
    })

    await expect(loginCopilotWithDeviceFlow({
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ANTHROPIC_AUTH_TOKEN: 'secret' },
      runProcess: ghRunProcess(),
      fetch: fetchFn,
      sleep: async (ms) => { now += ms },
      jitterMs: () => 0,
    })).resolves.toEqual({ authenticated: true, source: 'gh auth status' })
    expect(spawnMock).toHaveBeenCalledWith('gh', [
      'auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token',
    ], {
      env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    expect(stdin).toBe('test-store-token\n')
  })
})

function ghRunProcess(): RunProcess {
  return vi.fn<RunProcess>().mockImplementation(async (_command, args) => {
    if (args?.[0] === '--version') return { code: 0, stdout: 'gh version test', stderr: '' }
    if (args?.[0] === 'auth' && args[1] === 'status') return { code: 0, stdout: 'logged in', stderr: '' }
    return { code: 1, stdout: '', stderr: '' }
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-copilot-test-'))
  tmpDirs.push(dir)
  return dir
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn()
  return child
}

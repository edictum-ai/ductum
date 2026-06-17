import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clack = vi.hoisted(() => {
  const spinnerState = { start: vi.fn(), stop: vi.fn(), error: vi.fn() }
  return {
    note: vi.fn(),
    confirm: vi.fn(),
    spinner: vi.fn(() => spinnerState),
    isCancel: vi.fn(() => false),
    spinnerState,
  }
})

vi.mock('@clack/prompts', () => clack)

import { authenticateAnthropic } from '../../init/steps/auth-anthropic.js'
import type { CliContext } from '../../runtime.js'
import { createMockApi } from '../helpers.js'

const tmpDirs: string[] = []
const servers: Array<{ close: () => void }> = []

beforeEach(() => {
  for (const fn of [clack.note, clack.confirm, clack.spinner, clack.isCancel]) fn.mockClear()
  for (const fn of [clack.spinnerState.start, clack.spinnerState.stop, clack.spinnerState.error]) fn.mockClear()
})

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('init Anthropic auth step', () => {
  it('detects existing Anthropic auth without printing the token', async () => {
    const home = await tempDir()
    const stdout = new MemoryWritable()
    const ctx = makeCtx({ HOME: home, ANTHROPIC_OAUTH_TOKEN: 'secret-token' }, 'ndjson', stdout)

    const result = await authenticateAnthropic({
      ctx,
      deps: {},
      options: {},
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ authenticated: true, source: 'ANTHROPIC_OAUTH_TOKEN' })
    expect(events(stdout).map((event) => event.kind)).toEqual([
      'init.auth_started',
      'init.auth_detected_existing',
      'init.auth_completed',
    ])
    expect(stdout.text()).not.toContain('secret-token')
  })

  it('returns unauthenticated when the operator declines Claude login', async () => {
    const home = await tempDir()
    const ctx = makeCtx({ HOME: home }, 'human', new MemoryWritable(true))
    clack.confirm.mockResolvedValueOnce(false)

    const result = await authenticateAnthropic({
      ctx,
      deps: {},
      options: {},
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ authenticated: false })
    expect(clack.confirm).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Sign in to Claude now?',
      initialValue: true,
    }))
    expect(clack.note.mock.calls[0]?.[0]).toContain('ductum login')
  })

  it('runs the PKCE path and stores Claude credentials with 0600 perms', async () => {
    const home = await tempDir()
    const stdout = new MemoryWritable(true)
    const ctx = makeCtx({ HOME: home }, 'human', stdout)
    clack.confirm.mockResolvedValueOnce(true)

    const result = await authenticateAnthropic({
      ctx,
      deps: {
        anthropicOAuth: {
          generatePKCE: async () => pkce('1'),
          port: 53740,
          openBrowser: async (url) => {
            const page = await completeCallback(url, 'code-1', 'state-1')
            expect(page).not.toContain('access-token-1')
          },
          fetch: async () => jsonResponse({
            access_token: 'access-token-1',
            refresh_token: 'refresh-token-1',
            expires_in: 3600,
          }),
        },
      },
      options: {},
      signal: new AbortController().signal,
    })

    const path = join(home, '.claude', '.credentials.json')
    expect(result).toEqual({ authenticated: true, source: path })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      claudeAiOauth: { accessToken: 'access-token-1', refreshToken: 'refresh-token-1' },
    })
    expect(stdout.text()).not.toContain('access-token-1')
    expect(clack.spinnerState.stop).toHaveBeenCalledWith('Authenticated as Claude subscription')
  })

  it('maps callback timeouts to a structured init auth error', async () => {
    const stdout = new MemoryWritable()
    const ctx = makeCtx({ HOME: await tempDir() }, 'ndjson', stdout)

    await expect(authenticateAnthropic({
      ctx,
      deps: { anthropicOAuth: { generatePKCE: async () => pkce('2'), port: 53741, timeoutMs: 10 } },
      options: { login: true },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ initCode: 'auth_pkce_callback_timeout' })

    expect(events(stdout).at(-1)).toMatchObject({
      kind: 'init.auth_failed',
      data: { provider: 'anthropic', reason: 'auth_pkce_callback_timeout' },
    })
  })

  it('maps callback port collisions to a structured init auth error', async () => {
    const held = await listenOnLocalhost()
    const stdout = new MemoryWritable()
    const ctx = makeCtx({ HOME: await tempDir() }, 'ndjson', stdout)

    await expect(authenticateAnthropic({
      ctx,
      deps: { anthropicOAuth: { generatePKCE: async () => pkce('3'), port: held.port } },
      options: { login: true },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ initCode: 'auth_pkce_callback_port_in_use' })

    expect(events(stdout).at(-1)).toMatchObject({
      kind: 'init.auth_failed',
      data: { provider: 'anthropic', reason: 'auth_pkce_callback_port_in_use' },
    })
  })

  it('emits sigint auth failure and closes the callback server on abort', async () => {
    const controller = new AbortController()
    const stdout = new MemoryWritable()
    const ctx = makeCtx({ HOME: await tempDir() }, 'ndjson', stdout)
    const promise = authenticateAnthropic({
      ctx,
      deps: { anthropicOAuth: { generatePKCE: async () => pkce('4'), port: 53742, timeoutMs: 5000 } },
      options: { login: true },
      signal: controller.signal,
    })
    const emitted = await waitForEvent(stdout, 'init.auth_pkce_url_emitted')
    const redirect = new URL(new URL(String(emitted.data.url)).searchParams.get('redirect_uri') ?? '')

    controller.abort()

    await expect(promise).rejects.toMatchObject({ initCode: 'init_cancelled' })
    expect(events(stdout).at(-1)).toMatchObject({
      kind: 'init.auth_failed',
      data: { provider: 'anthropic', reason: 'sigint' },
    })
    redirect.pathname = '/after-abort'
    await waitForClosed(redirect)
  })
})

function makeCtx(env: Record<string, string | undefined>, outputMode: CliContext['outputMode'], stdout: MemoryWritable): CliContext {
  return {
    api: createMockApi(),
    apiUrl: 'http://localhost:4100',
    env,
    json: false,
    outputMode,
    stdin: Readable.from(''),
    stdout,
    stderr: new MemoryWritable(),
    now: () => new Date('2026-04-04T12:00:00.000Z'),
    write: (_value, text) => stdout.write(`${text}\n`),
    writeEnvelope: (kind, data) => stdout.write(`${JSON.stringify({ schemaVersion: 1, kind, data, ts: '2026-04-04T12:00:00.000Z' })}\n`),
    writeText: (text) => stdout.write(`${text}\n`),
  }
}

async function completeCallback(authUrl: string, code: string, state: string): Promise<string> {
  const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') ?? '')
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', state)
  const response = await fetch(redirect)
  expect(response.status).toBe(200)
  return await response.text()
}

async function listenOnLocalhost(): Promise<{ port: number }> {
  const server = createServer((_req, res) => res.end('held'))
  servers.push(server)
  return await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ port: typeof address === 'object' && address != null ? address.port : 0 })
    })
  })
}

async function waitForEvent(stdout: MemoryWritable, kind: string): Promise<Record<string, unknown> & { data: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const event = events(stdout).find((item) => item.kind === kind)
    if (event != null) return event
    await delay(10)
  }
  throw new Error(`missing event: ${kind}`)
}

async function waitForClosed(url: URL): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fetch(url)
    } catch {
      return
    }
    await delay(10)
  }
  throw new Error('callback server still accepting requests')
}

function events(stdout: MemoryWritable): Array<Record<string, unknown> & { data: Record<string, unknown> }> {
  return stdout.text().trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function pkce(suffix: string) {
  const verifier = `${'v'.repeat(42)}${suffix}`
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest().toString('base64url'),
    state: `state-${suffix}`,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-auth-'))
  tmpDirs.push(dir)
  return dir
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class MemoryWritable extends Writable {
  private chunks: Buffer[] = []

  constructor(readonly isTTY = false) {
    super()
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  text() {
    return Buffer.concat(this.chunks).toString('utf8')
  }
}

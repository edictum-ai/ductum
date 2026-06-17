import { Readable, Writable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clack = vi.hoisted(() => {
  const spinnerState = { start: vi.fn(), stop: vi.fn(), error: vi.fn() }
  return {
    note: vi.fn(),
    confirm: vi.fn(),
    multiselect: vi.fn(),
    spinner: vi.fn(() => spinnerState),
    isCancel: vi.fn(() => false),
    spinnerState,
  }
})

vi.mock('@clack/prompts', () => clack)

import { authenticateCodex } from '../../init/steps/auth-codex.js'
import { authenticateCopilot } from '../../init/steps/auth-copilot.js'
import { pickInitAgents } from '../../init/steps/agent-pickers.js'
import type { CliContext, RunProcess } from '../../runtime.js'
import { createMockApi } from '../helpers.js'

beforeEach(() => {
  for (const fn of [clack.note, clack.confirm, clack.multiselect, clack.spinner, clack.isCancel]) fn.mockClear()
  for (const fn of [clack.spinnerState.start, clack.spinnerState.stop, clack.spinnerState.error]) fn.mockClear()
})

describe('init Codex and Copilot auth steps', () => {
  it('skips Codex when existing OpenAI auth is detected', async () => {
    const stdout = new MemoryWritable()
    const runProcess = vi.fn<RunProcess>()

    const result = await authenticateCodex({
      ctx: makeCtx({ OPENAI_API_KEY: 'secret' }, 'ndjson', stdout),
      deps: { runProcess },
      options: {},
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ authenticated: true, source: 'OPENAI_API_KEY' })
    expect(runProcess).not.toHaveBeenCalled()
    expect(stdout.text()).not.toContain('secret')
  })

  it('declines Codex without spawning codex login', async () => {
    const runProcess = vi.fn<RunProcess>().mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    clack.confirm.mockResolvedValueOnce(false)

    const result = await authenticateCodex({
      ctx: makeCtx({}, 'human', new MemoryWritable(true)),
      deps: { runProcess },
      options: {},
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ authenticated: false })
    expect(runProcess).toHaveBeenCalledTimes(1)
    expect(runProcess).toHaveBeenCalledWith('codex', ['login', 'status'], expect.any(Object))
  })

  it('surfaces Codex subprocess failure as a structured init error', async () => {
    const runProcess = vi.fn<RunProcess>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 2, stdout: '', stderr: 'failed' })
    clack.confirm.mockResolvedValueOnce(true)

    await expect(authenticateCodex({
      ctx: makeCtx({}, 'human', new MemoryWritable(true)),
      deps: { runProcess },
      options: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ initCode: 'auth_codex_failed' })
  })

  it('maps SIGINT during Codex login to cancelled init', async () => {
    const controller = new AbortController()
    const runProcess = vi.fn<RunProcess>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockImplementationOnce(async () => {
        controller.abort()
        return { code: 130, stdout: '', stderr: '' }
      })
    clack.confirm.mockResolvedValueOnce(true)

    await expect(authenticateCodex({
      ctx: makeCtx({}, 'human', new MemoryWritable(true)),
      deps: { runProcess },
      options: {},
      signal: controller.signal,
    })).rejects.toMatchObject({ initCode: 'init_cancelled', exitCode: 130 })
  })

  it('runs Copilot device flow with mocked HTTP and gh storage', async () => {
    const home = '/tmp/ductum-auth-copilot-test'
    const runProcess = vi.fn<RunProcess>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValue({ code: 0, stdout: 'gh ok', stderr: '' })
    clack.confirm.mockResolvedValueOnce(true)
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return json({ access_token: 'test-access-token' })
    })

    const result = await authenticateCopilot({
      ctx: makeCtx({ HOME: home }, 'human', new MemoryWritable(true)),
      deps: {
        runProcess,
        copilotOAuth: {
          fetch: fetchFn,
          sleep: async () => undefined,
          jitterMs: () => 0,
          storeToken: async () => ({ code: 0, stdout: '', stderr: '' }),
        },
      },
      options: {},
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ authenticated: true, source: 'gh auth status' })
    expect(clack.note.mock.calls.join('\n')).not.toContain('test-access-token')
    expect(clack.note.mock.calls.join('\n')).toContain('repository read/write')
  })

  it('maps SIGINT during Copilot polling to cancelled init', async () => {
    const controller = new AbortController()
    const runProcess = vi.fn<RunProcess>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValue({ code: 0, stdout: 'gh ok', stderr: '' })
    clack.confirm.mockResolvedValueOnce(true)
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      if (String(init?.body).includes('scope=')) return json({ device_code: 'device', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 })
      return json({ error: 'authorization_pending' })
    })

    await expect(authenticateCopilot({
      ctx: makeCtx({ HOME: '/tmp/ductum-auth-copilot-sigint' }, 'human', new MemoryWritable(true)),
      deps: {
        runProcess,
        copilotOAuth: {
          fetch: fetchFn,
          sleep: async (_ms, signal) => {
            expect(signal).toBe(controller.signal)
            controller.abort()
            throw new Error('aborted')
          },
          jitterMs: () => 0,
        },
      },
      options: {},
      signal: controller.signal,
    })).rejects.toMatchObject({ initCode: 'init_cancelled', exitCode: 130 })
  })

  it('maps missing gh to auth_copilot_gh_not_installed', async () => {
    const home = '/tmp/ductum-auth-copilot-missing-gh'
    const runProcess = vi.fn<RunProcess>()
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 127, stdout: '', stderr: 'missing gh' })
    clack.confirm.mockResolvedValueOnce(true)

    await expect(authenticateCopilot({
      ctx: makeCtx({ HOME: home }, 'human', new MemoryWritable(true)),
      deps: { runProcess },
      options: {},
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ initCode: 'auth_copilot_gh_not_installed' })
  })

  it('lets the operator pick from authenticated agents only', async () => {
    clack.multiselect.mockResolvedValueOnce(['anthropic', 'copilot'])
    const stdout = new MemoryWritable(true)

    const result = await pickInitAgents({
      ctx: makeCtx({}, 'human', stdout),
      authenticated: ['anthropic', 'codex', 'copilot'],
    })

    expect(result).toEqual(['anthropic', 'copilot'])
    expect(clack.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['anthropic', 'codex', 'copilot'],
    }))
  })
})

function makeCtx(env: Record<string, string | undefined>, outputMode: CliContext['outputMode'], stdout: MemoryWritable): CliContext {
  return {
    api: createMockApi(),
    apiUrl: 'http://localhost:4100',
    env: { DUCTUM_NO_BROWSER: '1', ...env },
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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
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

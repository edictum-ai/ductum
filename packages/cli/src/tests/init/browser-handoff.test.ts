import { readFileSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const clack = vi.hoisted(() => ({
  note: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn() })),
}))

vi.mock('@clack/prompts', () => clack)

import { buildApiEnv, buildApiProcessArgs } from '../../init/steps/api-process.js'
import { runPostScaffoldHandoff } from '../../init/steps/browser-handoff.js'
import type { CliContext } from '../../runtime.js'

const tmpDirs: string[] = []

beforeEach(() => {
  clack.note.mockClear()
  clack.spinner.mockClear()
})

afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('init browser handoff', () => {
  it('writes factory operator-token files, mints handoff, and withholds the handoff token for --no-browser', async () => {
    const projectDir = await factoryDir()
    const fetchMock = createFetchMock()
    const openBrowser = vi.fn()

    const result = await runPostScaffoldHandoff({
      ctx: fakeContext({ outputMode: 'human' }),
      options: { browser: false },
      projectDir,
      projectName: 'factory',
      agents: ['anthropic', 'codex', 'copilot'],
      seed: { agentCount: 3, skippedAgents: [] },
      deps: fakeDeps({ fetch: fetchMock, openBrowser }),
    })

    const token = readFileSync(result.tokenPath, 'utf8').trim()
    expect(token).toHaveLength(43)
    expect(readFileSync(result.envPath, 'utf8')).toBe(`DUCTUM_OPERATOR_TOKEN=${token}\n`)
    expect(statSync(result.tokenPath).mode & 0o777).toBe(0o600)
    expect(statSync(result.envPath).mode & 0o777).toBe(0o600)
    expect(openBrowser).not.toHaveBeenCalled()
    expect(result.handoffUrl).toBe('http://127.0.0.1:4777/welcome?token=handoff_secret')
    expect(clack.note.mock.calls[0]?.[0]).toContain('http://127.0.0.1:4777/welcome')
    expect(clack.note.mock.calls[0]?.[0]).not.toContain('handoff_secret')
    expect(clack.note.mock.calls[0]?.[0]).not.toContain(token)
    expect(clack.note.mock.calls[0]?.[0]).toContain(`Token file written: ${result.tokenPath}`)
    expect(clack.note.mock.calls[0]?.[0]).toContain('export DUCTUM_OPERATOR_TOKEN="$(cat ')
    expect(clack.note.mock.calls[0]?.[0]).toContain('ductum status --api-url http://127.0.0.1:4777')
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/factory'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/projects'))).toBe(false)
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/agents'))).toBe(false)
    expect(result.seededAgents).toBe(3)
    expect(result.skippedAgents).toEqual([])

    for (const [, init] of protectedFetchCalls(fetchMock)) {
      expect((init?.headers as Record<string, string>)['x-ductum-operator-token']).toBe(token)
    }
  })

  it('opens the handoff URL but only prints the clean dashboard URL', async () => {
    const projectDir = await factoryDir()
    const fetchMock = createFetchMock()
    const openBrowser = vi.fn().mockResolvedValue(undefined)

    const result = await runPostScaffoldHandoff({
      ctx: fakeContext({ outputMode: 'human' }),
      options: {},
      projectDir,
      projectName: 'factory',
      agents: ['codex'],
      deps: fakeDeps({ fetch: fetchMock, openBrowser }),
    })

    expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:4777/welcome?token=handoff_secret')
    expect(result.browserOpened).toBe(true)
    expect(clack.note.mock.calls[0]?.[0]).toContain('http://127.0.0.1:4777/welcome')
    expect(clack.note.mock.calls[0]?.[0]).not.toContain('handoff_secret')
    expect(clack.note.mock.calls[0]?.[0]).not.toContain('export DUCTUM_OPERATOR_TOKEN')
  })

  it('emits structured handoff events without writing either token to stdout', async () => {
    const projectDir = await factoryDir()
    const stdout = new MemoryWritable()
    const fetchMock = createFetchMock()

    const result = await runPostScaffoldHandoff({
      ctx: fakeContext({ outputMode: 'ndjson', stdout }),
      options: {},
      projectDir,
      projectName: 'factory',
      agents: ['codex'],
      deps: fakeDeps({ fetch: fetchMock }),
    })

    const token = readFileSync(result.tokenPath, 'utf8').trim()
    const text = stdout.toString()
    expect(text).not.toContain(token)
    expect(text).not.toContain('handoff_secret')
    const kinds = text.trim().split('\n').map((line) => JSON.parse(line).kind)
    expect(kinds).toEqual(['init.operator_token_created', 'init.api_starting', 'init.api_ready', 'init.handoff_created', 'init.browser_skipped'])
    expect(result.browserSkippedReason).toBe('non_human_output')
  })

  it('honors DUCTUM_NO_BROWSER=1', async () => {
    const projectDir = await factoryDir()
    const fetchMock = createFetchMock()
    const openBrowser = vi.fn()

    const result = await runPostScaffoldHandoff({
      ctx: fakeContext({ outputMode: 'human', env: { DUCTUM_NO_BROWSER: '1' } }),
      options: {},
      projectDir,
      projectName: 'factory',
      agents: ['codex'],
      deps: fakeDeps({ fetch: fetchMock, openBrowser }),
    })

    expect(openBrowser).not.toHaveBeenCalled()
    expect(result.browserSkippedReason).toBe('env')
    expect(clack.note.mock.calls[0]?.[0]).toContain('http://127.0.0.1:4777/welcome')
    expect(clack.note.mock.calls[0]?.[0]).not.toContain('handoff_secret')
  })

  it('stops the API process and masks API response bodies on handoff failure', async () => {
    const projectDir = await factoryDir()
    const stop = vi.fn()
    const fetchMock = createFailingHandoffFetch()

    let error: unknown
    try {
      await runPostScaffoldHandoff({
        ctx: fakeContext({ outputMode: 'human' }),
        options: { browser: false },
        projectDir,
        projectName: 'factory',
        agents: ['codex'],
        deps: {
          ...fakeDeps({ fetch: fetchMock }),
          startApiProcess: vi.fn().mockResolvedValue({ pid: 123, logPath: '/factory/.ductum/logs/api.log', stop }),
        },
      })
    } catch (caught) {
      error = caught
    }

    expect(stop).toHaveBeenCalledTimes(1)
    expect(error).toMatchObject({ initCode: 'init_handoff_failed' })
    expect(String((error as { context?: { cause?: string } }).context?.cause)).not.toContain('operator_secret')
  })

  it('starts the source API on loopback with a sanitized environment', async () => {
    const env = buildApiEnv({
      repoRoot: '/repo',
      projectDir: '/factory',
      port: 4777,
      operatorToken: 'operator_secret',
      env: {
        PATH: '/bin',
        HOME: '/home/operator',
        TERM: 'xterm',
        ANTHROPIC_AUTH_TOKEN: 'anthropic_secret',
        OPENAI_API_KEY: 'openai_secret',
      },
    })

    expect(env).toMatchObject({
      PATH: '/bin',
      HOME: '/home/operator',
      TERM: 'xterm',
      DUCTUM_HOST: '127.0.0.1',
      DUCTUM_PORT: '4777',
      DUCTUM_OPERATOR_TOKEN: 'operator_secret',
      DUCTUM_DASHBOARD_DIST: '/repo/packages/dashboard/dist',
      DUCTUM_WORKFLOWS_DIR: '/repo/workflows',
      DUCTUM_SAMPLE_SPECS_DIR: '/repo/packages/ductum/assets/specs/examples',
      DUCTUM_REPO_PATH_MAP: '{".":"/factory"}',
      DUCTUM_AGENTS_CONFIG: '{}',
    })
    expect(env).not.toHaveProperty('DUCTUM_CONFIG_PATH')
    expect(env.DUCTUM_HARNESS_MODULE_PATH).toBe('file:///repo/packages/harness/dist/index.js')
    expect(env.DUCTUM_MCP_MODULE_PATH).toBe('file:///repo/packages/mcp/dist/index.js')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('anthropic_secret')
    expect(env.OPENAI_API_KEY).toBe('openai_secret')
    expect(buildApiProcessArgs('/repo', '/factory', 4777)).toEqual([
      '/repo/packages/api/dist/index.js',
      '--host',
      '127.0.0.1',
      '--port',
      '4777',
      '--db',
      '/factory/ductum.db',
      '--dispatch',
    ])
  })

})

async function factoryDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-init-handoff-'))
  tmpDirs.push(dir)
  await mkdir(join(dir, '.ductum'), { recursive: true })
  return dir
}

function fakeDeps(overrides: { fetch: FetchMock; openBrowser?: (url: string) => Promise<void> }) {
  return {
    repoRoot: '/repo',
    fetch: overrides.fetch as unknown as typeof fetch,
    findFreePort: async () => 4777,
    startApiProcess: vi.fn().mockResolvedValue({
      pid: 123,
      logPath: '/factory/.ductum/logs/api.log',
      stop: vi.fn(),
    }),
    openBrowser: overrides.openBrowser ?? vi.fn().mockResolvedValue(undefined),
  }
}

type FetchMock = ReturnType<typeof createFetchMock>

function createFetchMock() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith('/api/health')) return json({ ok: true, operatorTokenProtected: true })
    if (path.endsWith('/api/welcome/handoff')) {
      return json({
        data: {
          token: 'handoff_secret',
          expiresAt: '2026-05-03T12:01:00.000Z',
          ttlSeconds: 60,
          welcomePath: '/welcome',
        },
      })
    }
    return json({ error: 'not found' }, 404)
  })
}

function createFailingHandoffFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const path = String(url)
    if (path.endsWith('/api/health')) return json({ ok: true, operatorTokenProtected: true })
    if (path.endsWith('/api/welcome/handoff')) return json({ error: 'operator_secret' }, 500)
    return json({ error: 'not found' }, 404)
  })
}

function protectedFetchCalls(fetchMock: FetchMock) {
  return fetchMock.mock.calls.filter(([url]) => !String(url).endsWith('/api/health'))
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

function fakeContext(input: { outputMode: 'human' | 'ndjson'; stdout?: Writable; env?: Record<string, string> }): CliContext {
  const stdout = input.stdout ?? new TtyMemoryWritable()
  return {
    api: {} as CliContext['api'],
    apiUrl: 'http://localhost:4100',
    env: { PATH: '/bin', HOME: '/home/operator', TERM: 'xterm', ...input.env },
    json: false,
    outputMode: input.outputMode,
    stdin: process.stdin,
    stdout,
    stderr: new MemoryWritable(),
    now: () => new Date('2026-05-03T12:00:00.000Z'),
    write: () => undefined,
    writeEnvelope: () => undefined,
    writeText: () => undefined,
  }
}

class MemoryWritable extends Writable {
  private chunks: string[] = []
  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString())
    callback()
  }
  toString() { return this.chunks.join('') }
}

class TtyMemoryWritable extends MemoryWritable {
  isTTY = true
}

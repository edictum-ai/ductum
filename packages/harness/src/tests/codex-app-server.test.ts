import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CodexAppServerHarnessAdapter } from '../codex-app-server.js'
import { buildCodexContainerLaunchEnv, buildCodexLaunchEnv, spawnCodexAppServer } from '../codex-app-server-process.js'
import { buildCodexMcpThreadConfig } from '../codex-mcp-config.js'
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


function scopedCodexHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ductum-scoped-codex-'))
  writeFileSync(join(home, 'auth.json'), '{}')
  return home
}

function containerSandbox(runtimeHostDir: string) {
  return {
    driver: 'container' as const,
    profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
    workingDir: '/tmp/ductum-run', worktreePaths: ['/tmp/ductum-run'], reusedWorktree: false,
    boundary: { filesystem: 'worktree-readWrite' as const, network: 'container-default' as const, credentials: 'scoped' as const, resources: 'none' as const, process: 'namespaced' as const },
    podman: { containerId: 'ctr-1', runId: 'run-1', command: '/usr/bin/podman', workdir: '/ductum/worktree', runtimeHostDir, runtimeDir: '/ductum/runtime' },
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
        detached: true,
        cwd: '/tmp/ductum-run',
        env: expect.objectContaining({
          CODEX_HOME: '/tmp/.codex-home/default',
          PATH: expect.stringContaining('/usr/local/bin'),
        }),
      }),
    )
  })

  it('passes a container-reachable MCP URL when starting a sandboxed Codex thread', async () => {
    const child = new FakeCodexProcess()
    const runtimeHostDir = mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))
    const scopedHome = scopedCodexHome()
    vi.mocked(spawn).mockReturnValue(child as never)

    const adapter = new CodexAppServerHarnessAdapter('http://127.0.0.1:49910')
    const session = await adapter.spawn(
      createRun({ id: 'run-1' as never }),
      createTask(),
      'system prompt',
      {} as never,
      {
        workingDir: '/tmp/ductum-run',
        controlToken: 'scoped-token',
        env: { DUCTUM_SCOPED_CODEX_HOME: scopedHome },
        sandbox: {
          driver: 'container',
          profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
          workingDir: '/tmp/ductum-run',
          worktreePaths: ['/tmp/ductum-run'],
          reusedWorktree: false,
          boundary: { filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced' },
          podman: { containerId: 'ctr-1', runId: 'run-1', command: '/usr/bin/podman', workdir: '/ductum/worktree', runtimeHostDir, runtimeDir: '/ductum/runtime' },
        },
      },
    )

    const calls = child.stdin.write.mock.calls.map(([chunk]) => String(chunk).trim())
    const threadStart = calls.map((line) => JSON.parse(line) as { method?: string; params?: { config?: unknown } })
      .find((msg) => msg.method === 'thread/start')
    expect(JSON.stringify(threadStart?.params?.config)).toContain(
      'http://host.containers.internal:49910/api/mcp/run-1?ductum_control_token=scoped-token',
    )
    expect(session.sandboxExecution).toEqual({ agentProcess: 'podman-container', containerId: 'ctr-1', workdir: '/ductum/worktree' })
    await session.waitForCompletion()
  })

  it('executes Codex inside a prepared Podman container when sandboxed', () => {
    const child = new FakeCodexProcess()
    const runtimeHostDir = mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))
    vi.mocked(spawn).mockReturnValue(child as never)

    spawnCodexAppServer('/tmp/ductum-run', {
      PATH: '/bin',
      OPENAI_API_KEY: 'sk-scoped',
      DUCTUM_RUN_ID: 'run-1',
      DUCTUM_CONTROL_TOKEN: 'scoped-token',
    } as NodeJS.ProcessEnv, {
      driver: 'container',
      profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
      workingDir: '/tmp/ductum-run',
      worktreePaths: ['/tmp/ductum-run'],
      reusedWorktree: false,
      boundary: { filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced' },
      podman: { containerId: 'ctr-1', runId: 'run-1', command: '/usr/bin/podman', workdir: '/ductum/worktree', runtimeHostDir, runtimeDir: '/ductum/runtime' },
    })

    const call = vi.mocked(spawn).mock.calls[0]
    expect(call?.[0]).toBe('/usr/bin/podman')
    expect(call?.[2]).toEqual({ stdio: ['pipe', 'pipe', 'pipe'] })
    const args = call?.[1] as string[]
    expect(args.slice(0, 4)).toEqual(['exec', '-i', '-w', '/ductum/worktree'])
    expect(args.slice(-6)).toEqual(['--', 'ctr-1', 'codex', 'app-server', '--listen', 'stdio://'])
    expect(args).toContain('DUCTUM_CONTROL_TOKEN=scoped-token')
    expect(args).toContain('DUCTUM_RUN_ID=run-1')
    expect(args).toContain('OPENAI_API_KEY=sk-scoped')
    expect(args).toContain('CODEX_HOME=/ductum/runtime/codex-home')
    expect(args).toContain('DUCTUM_CODEX_CONTAINERIZED=1')
    expect(args.some((arg) => arg.startsWith('DUCTUM_SCOPED_CODEX_HOME='))).toBe(false)
    expect(args).toContain('DUCTUM_CONTAINER_HOST_ALIAS=host.containers.internal')
    expect(args.indexOf('-i')).toBeLessThan(args.indexOf('--'))
  })

  it('marks host Codex workers as process-group owned where supported', () => {
    const child = new FakeCodexProcess()
    vi.mocked(spawn).mockReturnValue(child as never)

    const launched = spawnCodexAppServer('/tmp/ductum-run', {
      PATH: '/bin',
      DUCTUM_CODEX_COMMAND: '/custom/codex',
    } as NodeJS.ProcessEnv)

    expect(launched.child).toBe(child)
    expect(launched.ownership.kind).toBe(process.platform === 'win32' ? 'direct-child' : 'process-group')
  })

  it('copies Codex auth only from an explicit scoped source into the mounted Podman runtime directory', () => {
    const sourceHome = scopedCodexHome()
    const runtimeHostDir = mkdtempSync(join(tmpdir(), 'ductum-podman-runtime-'))

    const env = buildCodexContainerLaunchEnv({
      driver: 'container',
      profile: { id: 'sb' as never, name: 'podman', projectId: null, provider: 'podman', mode: 'container' },
      workingDir: '/tmp/ductum-run',
      worktreePaths: ['/tmp/ductum-run'],
      reusedWorktree: false,
      boundary: { filesystem: 'worktree-readWrite', network: 'container-default', credentials: 'scoped', resources: 'none', process: 'namespaced' },
      podman: { containerId: 'ctr-1', runId: 'run-1', command: '/usr/bin/podman', workdir: '/ductum/worktree', runtimeHostDir, runtimeDir: '/ductum/runtime' },
    }, {
      PATH: '/bin',
      DUCTUM_SCOPED_CODEX_HOME: sourceHome,
    } as NodeJS.ProcessEnv)

    expect(env.CODEX_HOME).toBe('/ductum/runtime/codex-home')
    expect(env.DUCTUM_CODEX_CONTAINERIZED).toBe('1')
    expect(env.DUCTUM_CONTAINER_HOST_ALIAS).toBe('host.containers.internal')
    expect(env.DUCTUM_SCOPED_CODEX_HOME).toBeUndefined()
    expect(existsSync(join(runtimeHostDir, 'codex-home', 'config.toml'))).toBe(true)
    expect(existsSync(join(runtimeHostDir, 'codex-home', 'auth.json'))).toBe(true)
  })

  it('rewrites loopback MCP URLs for containerized Codex', () => {
    const config = buildCodexMcpThreadConfig('http://127.0.0.1:49910', 'run-1' as never, {
      DUCTUM_CODEX_CONTAINERIZED: '1',
      DUCTUM_CONTROL_TOKEN: 'scoped-token',
    } as NodeJS.ProcessEnv)

    expect(JSON.stringify(config)).toContain('http://host.containers.internal:49910/api/mcp/run-1')
    expect(JSON.stringify(config)).toContain('ductum_control_token=scoped-token')
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

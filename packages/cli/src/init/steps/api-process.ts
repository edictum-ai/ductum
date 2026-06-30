import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { InitCommandError, initCancelledError } from '../errors.js'
import {
  buildApiEnv as buildRuntimeApiEnv,
  buildApiProcessArgs as buildRuntimeApiProcessArgs,
  resolveApiRuntimeLayout,
} from '../../serve/api-runtime.js'
import type { InitAgentProvider } from './agent-pickers.js'

export interface ApiProcessHandle {
  pid?: number
  logPath: string
  stop: () => void
}

export interface StartApiProcessInput {
  repoRoot: string
  projectDir: string
  port: number
  operatorToken: string
  env: Record<string, string | undefined>
  projectName?: string
  agents?: InitAgentProvider[]
}

export type StartApiProcess = (input: StartApiProcessInput) => Promise<ApiProcessHandle>

export async function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address != null && typeof address === 'object') resolve(address.port)
        else reject(new Error('could not allocate a loopback port'))
      })
    })
  })
}

export async function defaultStartApiProcess(input: StartApiProcessInput): Promise<ApiProcessHandle> {
  let layout: ReturnType<typeof resolveApiRuntimeLayout>
  try {
    layout = resolveApiRuntimeLayout({ repoRoot: input.repoRoot, startUrl: import.meta.url })
  } catch {
    throw apiDistMissing(input.repoRoot)
  }
  if (!existsSync(layout.apiEntry)) throw apiDistMissing(input.repoRoot)

  const logDir = join(input.projectDir, '.ductum', 'logs')
  await mkdir(logDir, { recursive: true })
  const logPath = join(logDir, 'api.log')
  const log = await open(logPath, 'a', 0o600)
  const child = spawn(process.execPath, buildApiProcessArgs(input.repoRoot, input.projectDir, input.port, layout.apiEntry), {
    cwd: layout.cwd,
    detached: true,
    env: buildApiEnv(input, layout),
    shell: false,
    stdio: ['ignore', log.fd, log.fd],
  })
  await log.close()
  child.unref()
  return {
    pid: child.pid,
    logPath,
    stop: () => stopProcess(child.pid),
  }
}

export function buildApiProcessArgs(
  repoRoot: string,
  projectDir: string,
  port: number,
  apiEntry = join(repoRoot, 'packages', 'api', 'dist', 'index.js'),
): string[] {
  return buildRuntimeApiProcessArgs({
    apiEntry,
    host: '127.0.0.1',
    port,
    dbPath: join(projectDir, 'ductum.db'),
    dispatch: true,
  })
}

export function buildApiEnv(
  input: StartApiProcessInput,
  layout = workspaceLayout(input.repoRoot),
): Record<string, string> {
  return buildRuntimeApiEnv({
    env: input.env,
    host: '127.0.0.1',
    port: input.port,
    operatorToken: input.operatorToken,
    dashboardDist: layout.dashboardDist,
    workflowsDir: layout.workflowsDir,
    sampleSpecsDir: layout.sampleSpecsDir,
    harnessModule: layout.harnessModule,
    mcpModule: layout.mcpModule,
    repoPathMap: { '.': input.projectDir },
    agentsConfig: agentsConfig(input.agents ?? []),
    worktreeConfig: { enabled: true, basePath: join(input.projectDir, '.ductum', 'worktrees') },
    heartbeatTimeoutSeconds: 120,
    heartbeatIntervalMs: 30_000,
    mergeConfig: {
      push: false,
      base: 'main',
      strategy: 'merge',
      pushTags: false,
      approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
    },
    costBudget: { perSpecHardUsd: 200 },
  })
}

export async function waitForProtectedApi(input: {
  apiUrl: string
  fetch: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
}): Promise<void> {
  const timeoutMs = input.timeoutMs ?? 15_000
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (input.signal?.aborted === true) throw initCancelledError()
    const ready = await readHealth(input.apiUrl, input.fetch).catch(() => null)
    if (ready?.ok === true && ready.operatorTokenProtected === true) return
    if (ready?.ok === true && ready.operatorTokenProtected !== true) throw apiUnprotected(input.apiUrl)
    await delay(100)
  }
  throw apiStartTimeout(input.apiUrl)
}

async function readHealth(apiUrl: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(`${apiUrl}/api/health`)
  if (!response.ok) return null
  return response.json() as Promise<{ ok: boolean; operatorTokenProtected: boolean }>
}

function stopProcess(pid: number | undefined): void {
  if (pid == null) return
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 'SIGTERM')
  } catch {
    try { process.kill(pid, 'SIGTERM') } catch {}
  }
}

function workspaceLayout(repoRoot: string) {
  return {
    dashboardDist: join(repoRoot, 'packages', 'dashboard', 'dist'),
    workflowsDir: join(repoRoot, 'workflows'),
    sampleSpecsDir: join(repoRoot, 'packages', 'ductum', 'assets', 'specs', 'examples'),
    harnessModule: join(repoRoot, 'packages', 'harness', 'dist', 'index.js'),
    mcpModule: join(repoRoot, 'packages', 'mcp', 'dist', 'index.js'),
  }
}

function agentsConfig(agents: InitAgentProvider[]): Record<string, { harness: string }> {
  const entries = agents.flatMap((agent): Array<[string, { harness: string }]> => {
    if (agent === 'codex') return [['codex-builder', { harness: 'codex-sdk' }]]
    if (agent === 'copilot') return [['copilot-builder', { harness: 'copilot-sdk' }]]
    return [
      ['claude-builder', { harness: 'claude-agent-sdk' }],
      ['claude-reviewer', { harness: 'claude-agent-sdk' }],
    ]
  })
  return Object.fromEntries(entries)
}

function apiDistMissing(repoRoot: string): InitCommandError {
  return new InitCommandError({
    code: 'init_api_dist_missing',
    message: 'Cannot start Ductum API because packages/api/dist/index.js does not exist.',
    recoverable: true,
    suggestedActions: [{ kind: 'build_source', description: 'Build the source checkout, then rerun init.', cmd: `cd ${repoRoot} && pnpm build` }],
    context: { repoRoot },
  })
}

function apiUnprotected(apiUrl: string): InitCommandError {
  return new InitCommandError({
    code: 'init_api_unprotected',
    message: 'Ductum API started without operator-token protection.',
    recoverable: true,
    suggestedActions: [{ kind: 'rerun_init', description: 'Stop the API process and rerun ductum init.' }],
    context: { apiUrl },
  })
}

function apiStartTimeout(apiUrl: string): InitCommandError {
  return new InitCommandError({
    code: 'init_api_start_timeout',
    message: 'Ductum API did not become ready after init.',
    recoverable: true,
    suggestedActions: [{ kind: 'inspect_api_log', description: 'Inspect the factory .ductum/logs/api.log file, then rerun init.' }],
    context: { apiUrl },
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

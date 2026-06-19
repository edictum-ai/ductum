import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'

import { createAction, loadLocalEnv, type CliContext, type CliProgramDeps } from '../runtime.js'
import { defaultOpenBrowser } from '../login/open-browser.js'
import { createStartBrowserHandoff } from '../serve/browser-handoff.js'
import { buildApiEnv, buildApiProcessArgs, resolveApiRuntimeLayout } from '../serve/api-runtime.js'
import { loadPersistedServeConfig } from '../serve/db-config.js'
import {
  defaultFactoryDataDir,
  resolveFactoryDir,
  resolveStartupBoundary,
} from '../serve/factory-data.js'
import { renderPlan, type ServePlan } from '../serve/start-plan.js'

interface ServeOptions {
  dir?: string
  db?: string
  host?: string
  port?: string
  dispatch?: boolean
  allowPublicHost?: boolean
  allowTokenDetect?: boolean
  operatorToken?: string
  browser?: boolean
  dryRun?: boolean
}

export function registerServeCommands(program: Command, deps: CliProgramDeps) {
  program
    .command('start')
    .description('Start or open the local Ductum Factory')
    .option('--dir <path>', `Factory data directory. Defaults to ${defaultFactoryDataDir()}.`)
    .option('--db <path>', 'Factory database path. Defaults to <dir>/ductum.db.')
    .option('--host <host>', 'API bind host. Defaults to 127.0.0.1.')
    .option('--port <port>', 'API port. Defaults to DUCTUM_PORT, the persisted Factory port, or 4100.')
    .option('--no-dispatch', 'Start with Factory Activity paused')
    .option('--allow-public-host', 'Allow a non-loopback API bind host')
    .option('--allow-token-detect', 'Enable the dashboard local reconnect endpoint')
    .option('--operator-token <token>', 'Operator token for this process; never written to disk')
    .option('--no-browser', 'Print the control-plane URL without opening a browser')
    .option('--dry-run', 'Print the start plan without launching the API')
    .action(createAction(deps, async (ctx, options: ServeOptions = {}) => {
      await runServeCommand(ctx, options)
    }))
}

async function runServeCommand(ctx: CliContext, options: ServeOptions): Promise<void> {
  const command = 'start'
  const factoryDir = resolveFactoryDir({ command, dir: options.dir, cwd: process.cwd(), env: ctx.env })
  loadLocalEnv({ cwd: factoryDir, env: ctx.env })
  const dbPath = resolvePath(factoryDir, options.db ?? ctx.env.DUCTUM_DB_PATH ?? 'ductum.db')
  resolveStartupBoundary({ command, factoryDir, dbPath })
  const config = loadPersistedServeConfig(dbPath, factoryDir)
  const host = (options.host ?? ctx.env.DUCTUM_HOST ?? config.apiBindHost ?? '127.0.0.1').trim()
  if (!isLoopbackHost(host) && options.allowPublicHost !== true) {
    throw new Error('Refusing to bind Ductum API outside loopback without --allow-public-host')
  }
  const port = parsePort(options.port ?? ctx.env.DUCTUM_PORT) ?? config.apiPort ?? 4100
  const operatorToken = resolveOperatorToken(options.operatorToken, ctx.env, factoryDir)
  const layout = resolveApiRuntimeLayout({ startUrl: import.meta.url, requireApiEntry: options.dryRun !== true })
  if (options.dryRun !== true && !existsSync(layout.apiEntry)) {
    throw new Error(`Ductum API runtime not found: ${layout.apiEntry}`)
  }
  const dispatch = options.dispatch !== false && config.dispatcherEnabled !== false
  const plan: ServePlan = {
    command,
    factoryDir,
    dbPath,
    apiUrl: `http://${host}:${port}`,
    host,
    port,
    dispatch,
    tokenDetectEnabled: options.allowTokenDetect === true,
    browserHandoffEnabled: isLoopbackHost(host),
    apiEntry: layout.apiEntry,
    dashboardDist: layout.dashboardDist,
    workflowsDir: layout.workflowsDir,
    sampleSpecsDir: layout.sampleSpecsDir,
  }
  if (options.dryRun === true) {
    ctx.writeEnvelope('start.plan', plan, renderPlan(plan))
    return
  }
  if (await apiHealthy(plan.apiUrl)) {
    await openControlPlane(ctx, options, plan, operatorToken)
    ctx.writeEnvelope(`${command}.opened`, plan, renderPlan(plan))
    return
  }
  ctx.writeEnvelope('start.started', plan, renderPlan(plan))
  if (options.allowTokenDetect === true && ctx.outputMode === 'human') {
    ctx.stderr.write('Warning: local dashboard reconnect is enabled for this loopback API process.\n')
  }
  await spawnApi({
    args: buildApiProcessArgs({
      apiEntry: layout.apiEntry,
      host,
      port,
      dbPath,
      dispatch,
    }),
    cwd: layout.cwd,
    apiUrl: plan.apiUrl,
    env: buildApiEnv({
      env: ctx.env,
      host,
      port,
      operatorToken,
      factoryDataDir: factoryDir,
      dashboardDist: layout.dashboardDist,
      workflowsDir: layout.workflowsDir,
      sampleSpecsDir: layout.sampleSpecsDir,
      harnessModule: layout.harnessModule,
      mcpModule: layout.mcpModule,
      repoPathMap: config.repoPathMap,
      agentsConfig: config.agentsConfig,
      worktreeConfig: config.worktreeConfig,
      heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      mergeConfig: config.mergeConfig,
      costBudget: config.costBudget,
      publicBaseUrl: config.publicBaseUrl,
      dashboardUrl: config.dashboardUrl ?? plan.apiUrl,
      workflowProfiles: config.workflowProfiles,
      observerMode: config.observerMode,
      tokenDetectEnabled: options.allowTokenDetect === true,
    }),
    onReady: async () => {
      await openControlPlane(ctx, options, plan, operatorToken)
    },
  })
}

function spawnApi(input: {
  args: string[]
  cwd: string
  env: Record<string, string>
  apiUrl: string
  onReady?: () => Promise<void>
}): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, input.args, {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: 'inherit',
    })
    child.once('error', reject)
    void waitForApiReady(input.apiUrl, input.onReady)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Ductum API exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

async function openControlPlane(ctx: CliContext, options: ServeOptions, plan: ServePlan, operatorToken: string): Promise<void> {
  const reason = browserSkipReason(ctx, options)
  if (reason != null) return
  const url = plan.browserHandoffEnabled
    ? await createStartBrowserHandoff({
      apiUrl: plan.apiUrl,
      operatorToken,
    }).then((handoff) => handoff.handoffUrl).catch((error: unknown) => {
      if (ctx.outputMode === 'human') {
        ctx.stderr.write(`Warning: browser handoff unavailable; opening dashboard without local session (${safeErrorMessage(error)}).\n`)
      }
      return plan.apiUrl
    })
    : plan.apiUrl
  await defaultOpenBrowser(url).catch(() => undefined)
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  return error.message.replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
}

function browserSkipReason(ctx: CliContext, options: ServeOptions): string | null {
  if (options.browser === false) return 'flag'
  if (ctx.env.DUCTUM_NO_BROWSER === '1') return 'env'
  if (ctx.outputMode !== 'human') return 'non_human_output'
  return 'isTTY' in ctx.stdout && ctx.stdout.isTTY === true ? null : 'non_tty'
}

async function waitForApiReady(apiUrl: string, onReady: (() => Promise<void>) | undefined): Promise<void> {
  if (onReady == null) return
  if (await apiHealthy(apiUrl, 15_000)) await onReady()
}

async function apiHealthy(apiUrl: string, timeoutMs = 700): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${apiUrl}/api/health`)
      if (response.ok) return true
    } catch {}
    await delay(100)
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveOperatorToken(
  requested: string | undefined,
  env: Record<string, string | undefined>,
  factoryDir: string,
): string {
  for (const token of [
    requested,
    env.DUCTUM_OPERATOR_TOKEN,
    readFactoryOperatorToken(factoryDir),
    readHomeOperatorToken(env),
  ]) {
    if (isUsableOperatorToken(token)) return token.trim()
  }
  throw new Error('No usable DUCTUM_OPERATOR_TOKEN found. Run ductum init or set DUCTUM_OPERATOR_TOKEN before ductum start.')
}

function readFactoryOperatorToken(factoryDir: string): string | undefined {
  return readTokenFile(join(factoryDir, '.ductum', 'operator-token'))
}

function readHomeOperatorToken(env: Record<string, string | undefined>): string | undefined {
  const home = env.HOME?.trim() || homedir()
  return readTokenFile(join(home, '.ductum', 'operator-token'))
}

function readTokenFile(tokenPath: string): string | undefined {
  if (!existsSync(tokenPath)) return undefined
  return readFileSync(tokenPath, 'utf8')
}

function resolvePath(base: string, value: string): string {
  return resolve(base, value)
}

function parsePort(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Invalid port: ${value}`)
  return port
}

function isLoopbackHost(value: string): boolean {
  return value === '' || value === 'localhost' || value === '127.0.0.1' || value === '::1'
}

function isUsableOperatorToken(value: string | undefined): value is string {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' && !['missing', 'changeme', 'replace-me', 'local-demo-token'].includes(trimmed.toLowerCase())
}

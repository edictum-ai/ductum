import * as p from '@clack/prompts'
import { fileURLToPath } from 'node:url'

import { defaultOpenBrowser } from '../../login/open-browser.js'
import type { CliContext } from '../../runtime.js'
import { InitCommandError } from '../errors.js'
import { writeInitEvent } from '../events.js'
import type { InitOptions } from '../options.js'
import { defaultStartApiProcess, findFreeLoopbackPort, waitForProtectedApi, type StartApiProcess } from './api-process.js'
import type { InitAgentProvider } from './agent-pickers.js'
import { writeFactoryOperatorToken } from './operator-token.js'
import { createWelcomeHandoff } from './welcome-seed.js'

export interface InitHandoffDeps {
  repoRoot?: string
  fetch?: typeof fetch
  findFreePort?: () => Promise<number>
  startApiProcess?: StartApiProcess
  openBrowser?: (url: string) => Promise<void>
}

export interface InitHandoffResult {
  apiUrl: string
  dashboardUrl: string
  handoffUrl: string | null
  browserOpened: boolean
  browserSkippedReason: string | null
  tokenPath: string
  envPath: string
  logPath: string
  apiPid?: number
  seededAgents: number
  skippedAgents: InitAgentProvider[]
}

export async function runPostScaffoldHandoff(input: {
  ctx: CliContext
  options: InitOptions
  projectDir: string
  projectName: string
  agents: InitAgentProvider[]
  seed?: { agentCount: number; skippedAgents: InitAgentProvider[] }
  signal?: AbortSignal
  deps?: InitHandoffDeps
}): Promise<InitHandoffResult> {
  const deps = resolveDeps(input.deps)
  const spinner = input.ctx.outputMode === 'human'
    ? p.spinner({ input: input.ctx.stdin, output: input.ctx.stdout })
    : null
  spinner?.start('Starting local Ductum API')
  const token = await writeFactoryOperatorToken(input.projectDir)
  writeInitEvent(input.ctx, 'init.operator_token_created', {
    tokenPath: token.tokenPath,
    envPath: token.envPath,
  })
  const port = await deps.findFreePort()
  const apiUrl = `http://127.0.0.1:${port}`
  writeInitEvent(input.ctx, 'init.api_starting', { apiUrl, host: '127.0.0.1', port })
  const apiProcess = await deps.startApiProcess({
    repoRoot: deps.repoRoot,
    projectDir: input.projectDir,
    port,
    operatorToken: token.token,
    env: input.ctx.env,
    projectName: input.projectName,
    agents: input.agents,
  })
  try {
    await waitForProtectedApi({ apiUrl, fetch: deps.fetch, signal: input.signal })
  } catch (error) {
    apiProcess.stop()
    throw error
  }
  writeInitEvent(input.ctx, 'init.api_ready', {
    apiUrl,
    pid: apiProcess.pid ?? null,
    logPath: apiProcess.logPath,
  })
  let handoff: Awaited<ReturnType<typeof createWelcomeHandoff>>
  try {
    handoff = await wrapApiStep('init_handoff_failed', 'Failed to mint the browser handoff token.', () =>
      createWelcomeHandoff({ apiUrl, operatorToken: token.token, fetch: deps.fetch }))
  } catch (error) {
    apiProcess.stop()
    throw error
  }
  writeInitEvent(input.ctx, 'init.handoff_created', {
    welcomePath: handoff.welcomePath,
    expiresAt: handoff.expiresAt,
    ttlSeconds: handoff.ttlSeconds,
  })
  const dashboardUrl = `${apiUrl}${handoff.welcomePath}`
  const handoffUrl = buildPairingUrl(apiUrl, handoff.welcomePath, handoff.token)
  const browser = await maybeOpenBrowser({
    ctx: input.ctx,
    options: input.options,
    openBrowser: deps.openBrowser,
    browserUrl: handoffUrl ?? dashboardUrl,
  })
  writeInitEvent(input.ctx, browser.opened ? 'init.browser_opened' : 'init.browser_skipped', {
    dashboardUrl,
    reason: browser.reason,
  })
  spinner?.stop('Ductum API is running')
  showHandoffNote(input.ctx, {
    apiUrl,
    dashboardUrl,
    handoffUrl,
    opened: browser.opened,
    reason: browser.reason,
    tokenPath: token.tokenPath,
  })
  return {
    apiUrl,
    dashboardUrl,
    handoffUrl,
    browserOpened: browser.opened,
    browserSkippedReason: browser.reason,
    tokenPath: token.tokenPath,
    envPath: token.envPath,
    logPath: apiProcess.logPath,
    apiPid: apiProcess.pid,
    seededAgents: input.seed?.agentCount ?? 0,
    skippedAgents: input.seed?.skippedAgents ?? [],
  }
}

function resolveDeps(deps: InitHandoffDeps | undefined): Required<InitHandoffDeps> {
  return {
    repoRoot: deps?.repoRoot ?? fileURLToPath(new URL('../../../../../', import.meta.url)),
    fetch: deps?.fetch ?? fetch,
    findFreePort: deps?.findFreePort ?? findFreeLoopbackPort,
    startApiProcess: deps?.startApiProcess ?? defaultStartApiProcess,
    openBrowser: deps?.openBrowser ?? defaultOpenBrowser,
  }
}

async function maybeOpenBrowser(input: {
  ctx: CliContext
  options: InitOptions
  openBrowser: (url: string) => Promise<void>
  browserUrl: string
}): Promise<{ opened: boolean; reason: string | null }> {
  const reason = browserSkipReason(input.ctx, input.options)
  if (reason != null) return { opened: false, reason }
  try {
    await input.openBrowser(input.browserUrl)
    return { opened: true, reason: null }
  } catch {
    return { opened: false, reason: 'open_failed' }
  }
}

function browserSkipReason(ctx: CliContext, options: InitOptions): string | null {
  if (options.browser === false) return 'flag'
  if (ctx.env.DUCTUM_NO_BROWSER === '1') return 'env'
  if (ctx.outputMode !== 'human') return 'non_human_output'
  return 'isTTY' in ctx.stdout && ctx.stdout.isTTY === true ? null : 'non_tty'
}

function showHandoffNote(
  ctx: CliContext,
  handoff: {
    apiUrl: string
    dashboardUrl: string
    handoffUrl: string | null
    opened: boolean
    reason: string | null
    tokenPath: string
  },
): void {
  if (ctx.outputMode !== 'human') return
  const lines = [`API: ${handoff.apiUrl}`, `Token file written: ${handoff.tokenPath}`]
  const needsCliAuth = !handoff.opened || handoff.handoffUrl == null
  if (handoff.opened) lines.push(`Dashboard: ${handoff.dashboardUrl}`, 'Browser: opened')
  else {
    lines.push(
      `Dashboard: ${handoff.dashboardUrl}`,
      `Browser: skipped (${handoff.reason ?? 'unknown'})`,
    )
  }
  if (needsCliAuth) {
    if (handoff.handoffUrl != null) lines.push(`Dashboard pairing: ${handoff.handoffUrl}`)
    lines.push(
      `CLI auth: ${renderTokenExportCommand(handoff.tokenPath)}`,
      `Then: ductum status --api-url ${handoff.apiUrl}`,
    )
  }
  p.note(lines.join('\n'), 'Dashboard', { input: ctx.stdin, output: ctx.stdout })
}

function buildPairingUrl(apiUrl: string, welcomePath: string, token: string | null | undefined): string | null {
  if (typeof token !== 'string' || token.trim().length === 0) return null
  return `${apiUrl}${welcomePath}?pair=${encodeURIComponent(token)}`
}

export function renderTokenExportCommand(tokenPath: string): string {
  const quotedPath = shellQuote(tokenPath)
  return [
    `if [ ! -r ${quotedPath} ]; then`,
    `printf '%s\\n' ${shellQuote(`Ductum operator token file missing: ${tokenPath}`)} ${shellQuote('Run ductum init --no-login --no-browser again to mint a new local token file.')} >&2;`,
    'false;',
    'else',
    `export DUCTUM_OPERATOR_TOKEN="$(cat ${quotedPath})";`,
    'fi',
  ].join(' ')
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`
}

async function wrapApiStep<T>(code: string, message: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    throw new InitCommandError({
      code,
      message,
      recoverable: true,
      suggestedActions: [{ kind: 'inspect_api_log', description: 'Inspect .ductum/logs/api.log and rerun ductum init.' }],
      context: { cause: error instanceof Error ? error.message : String(error) },
    })
  }
}

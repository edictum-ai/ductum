import * as p from '@clack/prompts'

import type { CliContext, CliProgramDeps } from '../../runtime.js'
import { readClaudeCredentials, resolveClaudeCredentialsPath, writeClaudeCredentials } from '../../login/claude-credentials.js'
import { defaultOpenBrowser } from '../../login/open-browser.js'
import { AuthPkceError, loginAnthropicWithPkce } from '../../login/pkce-core.js'
import { InitCommandError, initCancelledError } from '../errors.js'
import { writeInitEvent } from '../events.js'
import type { InitOptions } from '../options.js'
import type { InitPromptOptions } from './welcome.js'

type AuthInput = {
  ctx: CliContext
  deps: CliProgramDeps
  options: InitOptions
  signal: AbortSignal
  promptOptions?: InitPromptOptions
}

export async function authenticateAnthropic(input: AuthInput): Promise<{ authenticated: boolean; source?: string }> {
  writeInitEvent(input.ctx, 'init.auth_started', { provider: 'anthropic' })
  const existing = detectExistingAnthropic(input.ctx.env)
  if (existing != null) {
    writeInitEvent(input.ctx, 'init.auth_detected_existing', existing)
    humanNote(input, `Detected ${existing.label} via ${existing.source}`, 'Auth - Claude')
    writeInitEvent(input.ctx, 'init.auth_completed', { provider: 'anthropic', authenticated: true, source: existing.source })
    return { authenticated: true, source: existing.source }
  }

  const accepted = await shouldAuthenticate(input)
  if (!accepted) {
    humanNote(input, 'Run ductum login later to enable the Claude builder.', 'Claude auth skipped')
    writeInitEvent(input.ctx, 'init.auth_completed', { provider: 'anthropic', authenticated: false })
    return { authenticated: false }
  }

  return await runPkce(input)
}

function detectExistingAnthropic(env: Record<string, string | undefined>): { label: string; source: string } | null {
  for (const source of ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']) {
    if (env[source]?.trim()) return { label: 'Anthropic', source }
  }
  const path = resolveClaudeCredentialsPath(env)
  return readClaudeCredentials(path) == null ? null : { label: 'Anthropic', source: path }
}

async function shouldAuthenticate(input: AuthInput): Promise<boolean> {
  if (input.options.login === false) return false
  if (input.ctx.outputMode !== 'human') return input.options.login === true
  const confirmed = await p.confirm({
    message: 'Sign in to Claude now?',
    initialValue: true,
    ...input.promptOptions,
  })
  if (p.isCancel(confirmed)) throw initCancelledError()
  return confirmed === true
}

async function runPkce(input: AuthInput): Promise<{ authenticated: boolean; source?: string }> {
  const spinner = input.ctx.outputMode === 'human' ? p.spinner(input.promptOptions) : null
  spinner?.start('Waiting for Claude authentication')
  try {
    const path = resolveClaudeCredentialsPath(input.ctx.env)
    const credentials = await loginAnthropicWithPkce({
      ...input.deps.anthropicOAuth,
      signal: input.signal,
      openBrowser: shouldOpenBrowser(input) ? input.deps.anthropicOAuth?.openBrowser ?? defaultOpenBrowser : undefined,
      onAuth: (url) => {
        writeInitEvent(input.ctx, 'init.auth_pkce_url_emitted', { provider: 'anthropic', url })
        humanNote(input, url, 'Open this URL to authenticate Claude')
      },
    })
    await writeClaudeCredentials(path, credentials)
    spinner?.stop('Authenticated as Claude subscription')
    writeInitEvent(input.ctx, 'init.auth_completed', { provider: 'anthropic', authenticated: true, source: path })
    return { authenticated: true, source: path }
  } catch (error) {
    spinner?.error('Claude authentication failed')
    writeInitEvent(input.ctx, 'init.auth_failed', { provider: 'anthropic', reason: input.signal.aborted ? 'sigint' : errorCode(error) })
    if (input.signal.aborted) throw initCancelledError()
    throw authError(error)
  }
}

function shouldOpenBrowser(input: { ctx: CliContext; options: InitOptions }): boolean {
  const stdoutIsTTY = 'isTTY' in input.ctx.stdout && input.ctx.stdout.isTTY === true
  return input.options.browser !== false && input.ctx.env.DUCTUM_NO_BROWSER !== '1' && input.ctx.outputMode === 'human' && stdoutIsTTY
}

function humanNote(input: { ctx: CliContext; promptOptions?: InitPromptOptions }, message: string, title: string): void {
  if (input.ctx.outputMode === 'human') p.note(message, title, input.promptOptions)
}

function errorCode(error: unknown): string {
  return error instanceof AuthPkceError ? error.code : 'auth_anthropic_failed'
}

function authError(error: unknown): InitCommandError {
  const code = errorCode(error)
  return new InitCommandError({
    code: ['auth_pkce_callback_timeout', 'auth_pkce_callback_port_in_use'].includes(code) ? code : 'auth_anthropic_failed',
    message: 'Claude authentication failed.',
    recoverable: true,
    suggestedActions: [
      { kind: 'resume_init', description: 'Resume init at the Claude auth step.', cmd: 'ductum init --resume' },
      { kind: 'standalone_login', description: 'Authenticate Claude separately.', cmd: 'ductum login' },
    ],
    context: { reason: code },
  })
}

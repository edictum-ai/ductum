import * as p from '@clack/prompts'

import type { CliContext, CliProgramDeps } from '../../runtime.js'
import { CodexLoginError, detectExistingCodex, loginCodex } from '../../login/codex.js'
import { InitCommandError, initCancelledError } from '../errors.js'
import { writeInitEvent } from '../events.js'
import type { InitOptions } from '../options.js'
import type { InitPromptOptions } from './welcome.js'
import { defaultRunProcess } from '../scaffolders/git-init.js'

type AuthInput = {
  ctx: CliContext
  deps: CliProgramDeps
  options: InitOptions
  signal: AbortSignal
  promptOptions?: InitPromptOptions
}

export async function authenticateCodex(input: AuthInput): Promise<{ authenticated: boolean; source?: string }> {
  writeInitEvent(input.ctx, 'init.auth_codex_started', { provider: 'openai' })
  const runProcess = input.deps.runProcess ?? defaultRunProcess
  const existing = await detectExistingCodex({ env: input.ctx.env, runProcess, signal: input.signal })
  if (existing != null) {
    humanNote(input, `Detected OpenAI via ${existing.source}`, 'Auth - Codex')
    writeInitEvent(input.ctx, 'init.auth_codex_completed', { provider: 'openai', authenticated: true, source: existing.source })
    return { authenticated: true, source: existing.source }
  }
  const accepted = await shouldAuthenticate(input)
  if (!accepted) {
    humanNote(input, 'Run codex login later to enable the Codex builder.', 'Codex auth skipped')
    writeInitEvent(input.ctx, 'init.auth_codex_skipped', { provider: 'openai' })
    return { authenticated: false }
  }
  return await runLogin({ ...input, runProcess })
}

async function shouldAuthenticate(input: AuthInput): Promise<boolean> {
  if (input.options.login === false) return false
  if (input.ctx.outputMode !== 'human') return input.options.login === true
  const confirmed = await p.confirm({
    message: 'Sign in to OpenAI with Codex now?',
    initialValue: false,
    ...input.promptOptions,
  })
  if (p.isCancel(confirmed)) throw initCancelledError()
  return confirmed === true
}

async function runLogin(input: AuthInput & { runProcess: NonNullable<CliProgramDeps['runProcess']> }) {
  const spinner = input.ctx.outputMode === 'human' ? p.spinner(input.promptOptions) : null
  spinner?.start('Waiting for Codex login')
  try {
    const result = await loginCodex({
      env: input.ctx.env,
      runProcess: input.deps.runProcess,
      signal: input.signal,
      onAuthUrl: (url) => humanNote(input, url, 'Codex login URL'),
    })
    spinner?.stop('Authenticated with Codex')
    humanNote(input, [
      'Credentials remain in the Codex CLI store.',
      'Revoke or refresh them with codex login status / codex login.',
      result.stderrCaptured === true ? 'Codex stderr was captured and not printed.' : '',
    ].filter(Boolean).join('\n'), 'Codex auth complete')
    writeInitEvent(input.ctx, 'init.auth_codex_completed', { provider: 'openai', authenticated: true, source: result.source })
    return { authenticated: true, source: result.source }
  } catch (error) {
    spinner?.error('Codex login failed')
    if (input.signal.aborted) throw initCancelledError()
    writeInitEvent(input.ctx, 'init.auth_codex_failed', { provider: 'openai', reason: errorCode(error) })
    throw authError(error)
  }
}

function humanNote(input: { ctx: CliContext; promptOptions?: InitPromptOptions }, message: string, title: string): void {
  if (input.ctx.outputMode === 'human') p.note(message, title, input.promptOptions)
}

function errorCode(error: unknown): string {
  return error instanceof CodexLoginError ? error.code : 'auth_codex_failed'
}

function authError(error: unknown): InitCommandError {
  return new InitCommandError({
    code: 'auth_codex_failed',
    message: 'Codex login failed.',
    recoverable: true,
    suggestedActions: [
      { kind: 'install_codex', description: 'Install or repair the Codex CLI, then retry init.', cmd: 'codex login' },
      { kind: 'rerun_init', description: 'Run Ductum init again.', cmd: 'ductum init' },
    ],
    context: { reason: errorCode(error) },
  })
}

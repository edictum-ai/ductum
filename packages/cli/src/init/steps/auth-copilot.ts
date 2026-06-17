import * as p from '@clack/prompts'

import type { CliContext, CliProgramDeps } from '../../runtime.js'
import { defaultOpenBrowser } from '../../login/open-browser.js'
import { CopilotLoginError, detectExistingCopilot, loginCopilotWithDeviceFlow } from '../../login/copilot.js'
import { InitCommandError, initCancelledError } from '../errors.js'
import { writeInitEvent } from '../events.js'
import type { InitOptions } from '../options.js'
import { defaultRunProcess } from '../scaffolders/git-init.js'
import type { InitPromptOptions } from './welcome.js'

type AuthInput = {
  ctx: CliContext
  deps: CliProgramDeps
  options: InitOptions
  signal: AbortSignal
  promptOptions?: InitPromptOptions
}

export async function authenticateCopilot(input: AuthInput): Promise<{ authenticated: boolean; source?: string }> {
  writeInitEvent(input.ctx, 'init.auth_copilot_started', { provider: 'github-copilot' })
  const runProcess = input.deps.runProcess ?? defaultRunProcess
  const existing = await detectExistingCopilot({ env: input.ctx.env, runProcess, signal: input.signal })
  if (existing != null) {
    humanNote(input, `Detected GitHub Copilot via ${existing.source}`, 'Auth - Copilot')
    writeInitEvent(input.ctx, 'init.auth_copilot_completed', { provider: 'github-copilot', authenticated: true, source: existing.source })
    return { authenticated: true, source: existing.source }
  }
  const accepted = await shouldAuthenticate(input)
  if (!accepted) {
    humanNote(input, 'Run ductum init again later to enable the Copilot builder.', 'Copilot auth skipped')
    writeInitEvent(input.ctx, 'init.auth_copilot_skipped', { provider: 'github-copilot' })
    return { authenticated: false }
  }
  return await runDeviceFlow({ ...input, runProcess })
}

async function shouldAuthenticate(input: AuthInput): Promise<boolean> {
  if (input.options.login === false) return false
  if (input.ctx.outputMode !== 'human') return input.options.login === true
  const confirmed = await p.confirm({
    message: 'Enable GitHub Copilot agent?',
    initialValue: false,
    ...input.promptOptions,
  })
  if (p.isCancel(confirmed)) throw initCancelledError()
  return confirmed === true
}

async function runDeviceFlow(input: AuthInput & { runProcess: NonNullable<CliProgramDeps['runProcess']> }) {
  const spinner = input.ctx.outputMode === 'human' ? p.spinner(input.promptOptions) : null
  spinner?.start('Waiting for GitHub device authorization')
  try {
    const result = await loginCopilotWithDeviceFlow({
      ...input.deps.copilotOAuth,
      env: input.ctx.env,
      runProcess: input.runProcess,
      signal: input.signal,
      onDeviceCode: (prompt) => {
        humanNote(input, `Enter code ${prompt.userCode} at ${prompt.verificationUri}`, 'GitHub device login')
        if (shouldOpenBrowser(input)) void defaultOpenBrowser(prompt.verificationUri)
      },
    })
    spinner?.stop('Authenticated with GitHub Copilot')
    humanNote(input, [
      'Credentials were stored by the GitHub CLI.',
      'Granted GitHub scopes: repo (repository read/write), read:org, gist (gist read/write).',
      'Check or revoke them with gh auth status and GitHub Settings > Applications.',
    ].join('\n'), 'Copilot auth complete')
    writeInitEvent(input.ctx, 'init.auth_copilot_completed', { provider: 'github-copilot', authenticated: true, source: result.source })
    return { authenticated: true, source: result.source }
  } catch (error) {
    spinner?.error('GitHub Copilot authentication failed')
    if (input.signal.aborted) throw initCancelledError()
    writeInitEvent(input.ctx, 'init.auth_copilot_failed', { provider: 'github-copilot', reason: errorCode(error) })
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
  return error instanceof CopilotLoginError ? error.code : 'auth_copilot_failed'
}

function authError(error: unknown): InitCommandError {
  const code = errorCode(error)
  return new InitCommandError({
    code,
    message: code === 'auth_copilot_device_code_timeout'
      ? 'GitHub Copilot device authorization timed out.'
      : code === 'auth_copilot_device_code_expired'
        ? 'GitHub Copilot device authorization expired.'
      : code === 'auth_copilot_gh_not_installed'
        ? 'GitHub CLI is required for Copilot credential storage.'
        : 'GitHub Copilot authentication failed.',
    recoverable: true,
    suggestedActions: [
      { kind: 'install_gh', description: 'Install GitHub CLI and authenticate.', cmd: 'gh auth login' },
      { kind: 'rerun_init', description: 'Run Ductum init again.', cmd: 'ductum init' },
    ],
    context: { reason: code },
  })
}

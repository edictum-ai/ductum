import { CommanderError } from 'commander'
import { redactPublicOutput, redactPublicText } from '@ductum/core'

import { createEnvelope, type SchemaEnvelope } from '../output.js'
import type { CliContext } from '../runtime.js'

export interface InitSuggestedAction {
  kind: string
  description: string
  cmd?: string
  args?: Record<string, unknown>
}

export interface InitErrorData {
  code: string
  message: string
  recoverable: boolean
  suggestedActions: InitSuggestedAction[]
  context: Record<string, unknown>
}

export class InitCommandError extends Error {
  readonly initCode: string
  readonly recoverable: boolean
  readonly suggestedActions: InitSuggestedAction[]
  readonly context: Record<string, unknown>
  readonly exitCode: number

  constructor(input: InitErrorData & { exitCode?: number }) {
    super(input.message)
    this.name = 'InitCommandError'
    this.initCode = input.code
    this.recoverable = input.recoverable
    this.suggestedActions = input.suggestedActions
    this.context = input.context
    this.exitCode = input.exitCode ?? 1
  }
}

export function initCancelledError(reason = 'sigint'): InitCommandError {
  return new InitCommandError({
    code: 'init_cancelled',
    message: 'Ductum init was cancelled.',
    recoverable: true,
    suggestedActions: [{ kind: 'rerun_init', description: 'Run ductum init again.' }],
    context: { reason },
    exitCode: 130,
  })
}

export function initErrorEnvelope(
  error: InitCommandError,
  now: () => Date,
): SchemaEnvelope<'error', InitErrorData> {
  return createEnvelope('error', {
    code: error.initCode,
    message: error.message,
    recoverable: error.recoverable,
    suggestedActions: error.suggestedActions,
    context: error.context,
  }, now)
}

export function writeInitError(ctx: CliContext, error: InitCommandError): never {
  if (ctx.outputMode === 'human') {
    ctx.stderr.write(renderHumanError(error))
  } else {
    ctx.stdout.write(`${JSON.stringify(redactPublicOutput(initErrorEnvelope(error, ctx.now)))}\n`)
  }
  throw new CommanderError(error.exitCode, error.initCode, error.message)
}

export function renderHumanError(error: InitCommandError): string {
  const lines = [`Error: ${error.message}`]
  if (error.suggestedActions.length > 0) {
    lines.push('', 'Suggested next steps:')
    for (const action of error.suggestedActions) {
      lines.push(`  - ${action.description}`)
      if (action.cmd != null) lines.push(`    ${action.cmd}`)
    }
  }
  return `${redactPublicText(lines.join('\n'))}\n`
}

import { readFile } from 'node:fs/promises'
import type { Readable, Writable } from 'node:stream'
import { Command, CommanderError } from 'commander'
import { redactPublicText } from '@ductum/core'

import { DuctumApiClient, DuctumApiError, type DuctumApi } from './api-client.js'
import { loadLocalEnv, resolveCliApiUrl } from './runtime-env.js'
import type { LoginAnthropicOptions } from './login/pkce-core.js'
import type { OpenEventStream } from './event-stream.js'
import { formatJson } from './format.js'
import { formatEnvelope, resolveOutputMode, type ResolvedOutputMode } from './output.js'

export { loadLocalEnv } from './runtime-env.js'

export interface CliProgramDeps {
  api?: DuctumApi
  createApi?: (apiUrl: string) => DuctumApi
  openEventStream?: OpenEventStream
  env?: Record<string, string | undefined>
  runProcess?: RunProcess
  resolveHostname?: (hostname: string) => Promise<unknown>
  stdin?: Readable
  stdout?: Writable
  stderr?: Writable
  now?: () => Date
  anthropicOAuth?: LoginAnthropicOptions
  copilotOAuth?: Partial<Omit<import('./login/copilot.js').LoginCopilotDeviceFlowOptions, 'env' | 'runProcess' | 'signal' | 'onDeviceCode'>>
  initHandoff?: Partial<import('./init/steps/browser-handoff.js').InitHandoffDeps> & { run?: typeof import('./init/steps/browser-handoff.js').runPostScaffoldHandoff }
}

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

export type RunProcess = (
  command: string,
  args?: string[],
  options?: { env?: Record<string, string | undefined>; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ProcessResult>

export interface CliContext {
  api: DuctumApi
  apiUrl: string
  env: Record<string, string | undefined>
  json: boolean
  outputMode: ResolvedOutputMode
  stdin: Readable
  stdout: Writable
  stderr: Writable
  now: () => Date
  write: (value: unknown, text: string) => void
  writeEnvelope: (kind: string, data: unknown, human: string) => void
  writeText: (text: string) => void
}

export function createAction<Args extends unknown[]>(
  deps: CliProgramDeps,
  handler: (ctx: CliContext, ...args: Args) => Promise<void> | void,
) {
  return async (...args: unknown[]) => {
    const command = args.at(-1) as Command
    const params = args.slice(0, -1) as Args
    const ctx = createCliContext(command, deps)
    await handler(ctx, ...params)
  }
}

export function configureProgramOutput(program: Command, deps: CliProgramDeps) {
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  program.configureOutput({
    writeOut: (text) => {
      stdout.write(redactPublicText(text))
    },
    writeErr: (text) => {
      stderr.write(redactPublicText(text))
    },
    outputError: (text, write) => {
      write(redactPublicText(text))
    },
  })
}

export function createCliContext(command: Command, deps: CliProgramDeps): CliContext {
  const options = command.optsWithGlobals<{ apiUrl?: string; json?: boolean; ndjson?: boolean; human?: boolean }>()
  const env = deps.env ?? process.env
  const apiUrl = resolveCliApiUrl(options.apiUrl, env)
  const api = deps.api ?? deps.createApi?.(apiUrl) ?? new DuctumApiClient(apiUrl, env)
  const stdout = deps.stdout ?? process.stdout
  const stderr = deps.stderr ?? process.stderr
  const outputMode = resolveOutputMode({
    flags: { json: options.json, ndjson: options.ndjson, human: options.human },
    env,
    stdoutIsTTY: 'isTTY' in stdout && stdout.isTTY === true,
  })
  const now = deps.now ?? (() => new Date())

  return {
    api,
    apiUrl,
    env,
    json: options.json === true,
    outputMode,
    stdin: deps.stdin ?? process.stdin,
    stdout,
    stderr,
    now,
    write(value, text) {
      stdout.write((this.json ? `${formatJson(value)}\n` : ensureTrailingNewline(redactPublicText(text))))
    },
    writeEnvelope(kind, data, human) {
      stdout.write(formatEnvelope(this.outputMode, kind, data, human, this.now))
    },
    writeText(text) {
      stdout.write(ensureTrailingNewline(redactPublicText(text)))
    },
  }
}

export function writeWarnings(ctx: Pick<CliContext, 'json' | 'stderr' | 'stdout'>, warnings: string[]) {
  for (const warning of warnings) {
    const line = `Warning: ${redactPublicText(warning)}\n`
    if (ctx.json) ctx.stderr.write(line)
    else ctx.stdout.write(line)
  }
}

export function normalizeArgv(argv: string[]) {
  if (argv.length <= 2) {
    return argv
  }

  const head = argv.slice(0, 2)
  const globals: string[] = []
  const rest: string[] = []

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg == null) {
      continue
    }
    if (arg === '--json' || arg === '--ndjson' || arg === '--human') {
      globals.push(arg)
      continue
    }
    if (arg === '--api-url' && index + 1 < argv.length) {
      const value = argv[index + 1]
      if (value != null) {
        globals.push(arg, value)
      }
      index += 1
      continue
    }
    if (arg.startsWith('--api-url=')) {
      globals.push(arg)
      continue
    }
    rest.push(arg)
  }

  return [...head, ...globals, ...rest]
}

export async function readPromptInput(stdin: Readable, file?: string) {
  if (file != null) {
    return readFile(file, 'utf8')
  }
  if ('isTTY' in stdin && stdin.isTTY === true) {
    throw new Error('Task prompt must come from --file or stdin')
  }
  return readAll(stdin)
}

export function splitCsv(value: string, previous: string[] = []) {
  return [...previous, ...value.split(',').map((item) => item.trim()).filter(Boolean)]
}

export function parseJsonObject(value: string) {
  const parsed = JSON.parse(value) as unknown
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Expected a JSON object')
  }
  return parsed as Record<string, unknown>
}

export function formatError(error: unknown) {
  if (error instanceof CommanderError) {
    return error.message
  }
  if (error instanceof DuctumApiError && error.details !== undefined) {
    return redactPublicText(`${error.message}\n${formatJson(error.details)}`)
  }
  if (error instanceof Error) {
    return redactPublicText(error.message)
  }
  return redactPublicText(String(error))
}

function ensureTrailingNewline(text: string) { return text.endsWith('\n') ? text : `${text}\n` }

function readAll(stream: Readable) {
  return new Promise<string>((resolve, reject) => {
    let data = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      data += chunk
    })
    stream.once('end', () => resolve(data))
    stream.once('error', reject)
  })
}

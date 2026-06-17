import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { Command, CommanderError } from 'commander'
import { redactPublicText } from '@ductum/core'

import { DuctumApiClient, DuctumApiError, type DuctumApi } from './api-client.js'
import type { LoginAnthropicOptions } from './login/pkce-core.js'
import type { OpenEventStream } from './event-stream.js'
import { formatJson } from './format.js'
import { formatEnvelope, resolveOutputMode, type ResolvedOutputMode } from './output.js'

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
  const apiUrl = options.apiUrl ?? 'http://localhost:4100'
  const api = deps.api ?? deps.createApi?.(apiUrl) ?? new DuctumApiClient(apiUrl)
  const env = deps.env ?? process.env
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

export function loadLocalEnv({
  cwd = process.cwd(),
  env = process.env,
}: {
  cwd?: string
  env?: Record<string, string | undefined>
} = {}): string[] {
  const protectedKeys = new Set(
    Object.entries(env)
      .filter(([, value]) => value != null && value.trim() !== '')
      .map(([key]) => key),
  )
  const loaded = new Set<string>()
  for (const file of ['.env', '.env.local']) {
    const path = `${cwd}/${file}`
    if (!existsSync(path)) continue
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
      if (protectedKeys.has(key)) continue
      env[key] = value
      loaded.add(key)
    }
  }
  if (!protectedKeys.has('DUCTUM_OPERATOR_TOKEN') && !isUsableOperatorToken(env.DUCTUM_OPERATOR_TOKEN)) {
    const operatorToken = readOperatorTokenFile(env)
    if (isUsableOperatorToken(operatorToken)) {
      env.DUCTUM_OPERATOR_TOKEN = operatorToken ?? undefined
      loaded.add('DUCTUM_OPERATOR_TOKEN')
    }
  }
  return [...loaded]
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

const PLACEHOLDER_OPERATOR_TOKENS = new Set([
  'missing',
  'changeme',
  'replace-me',
  'local-demo-token',
  'replace-me-with-a-long-random-token',
])

function isUsableOperatorToken(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' && !PLACEHOLDER_OPERATOR_TOKENS.has(trimmed.toLowerCase())
}

function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const eq = body.indexOf('=')
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    values[key] = unquoteEnvValue(body.slice(eq + 1).trim())
  }
  return values
}

function unquoteEnvValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\n', '\n')
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

function readOperatorTokenFile(env: Record<string, string | undefined>): string | null {
  const home = env.HOME ?? homedir()
  const path = join(home, '.ductum', 'operator-token')
  if (!existsSync(path)) return null
  const value = readFileSync(path, 'utf8').trim()
  return value === '' ? null : value
}

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

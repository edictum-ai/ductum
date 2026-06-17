import { spawn } from 'node:child_process'
import type { ProcessResult, RunProcess } from '../runtime.js'

const CODEX_LOGIN_TIMEOUT_MS = 15 * 60_000
const CODEX_STATUS_TIMEOUT_MS = 10_000
const SAFE_AUTH_HOSTS = ['auth.openai.com', 'chatgpt.com', 'localhost', '127.0.0.1']

export interface CodexAuthResult {
  authenticated: boolean
  source?: string
  stderrCaptured?: boolean
}

export class CodexLoginError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly exitCode?: number,
  ) {
    super(message)
    this.name = 'CodexLoginError'
  }
}

export async function detectExistingCodex(input: {
  env: Record<string, string | undefined>
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<CodexAuthResult | null> {
  if (input.env.OPENAI_API_KEY?.trim()) return { authenticated: true, source: 'OPENAI_API_KEY' }
  const status = await input.runProcess('codex', ['login', 'status'], {
    env: sanitizedEnv(input.env),
    signal: input.signal,
    timeoutMs: CODEX_STATUS_TIMEOUT_MS,
  })
  return status.code === 0 ? { authenticated: true, source: 'codex login status' } : null
}

export async function loginCodex(input: {
  env: Record<string, string | undefined>
  runProcess?: RunProcess
  signal?: AbortSignal
  onAuthUrl?: (url: string) => void
}): Promise<CodexAuthResult> {
  const result = input.runProcess == null
    ? await runCodexLoginProcess(input)
    : await input.runProcess('codex', ['login'], {
      env: sanitizedEnv(input.env),
      signal: input.signal,
      timeoutMs: CODEX_LOGIN_TIMEOUT_MS,
    })
  if (result.code !== 0) {
    throw new CodexLoginError('auth_codex_failed', 'Codex login failed.', result.code)
  }
  return { authenticated: true, source: 'codex login', stderrCaptured: result.stderr.trim() !== '' }
}

export function sanitizedEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    PATH: env.PATH,
    HOME: env.HOME,
    TERM: env.TERM,
  }
}

function runCodexLoginProcess(input: {
  env: Record<string, string | undefined>
  signal?: AbortSignal
  onAuthUrl?: (url: string) => void
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['login'], {
      env: sanitizedEnv(input.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const seenUrls = new Set<string>()
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, CODEX_LOGIN_TIMEOUT_MS)
    const onAbort = () => child.kill('SIGTERM')
    const onOutput = (chunk: string, stream: 'stdout' | 'stderr') => {
      if (stream === 'stdout') stdout += chunk
      else stderr += chunk
      for (const url of extractCodexAuthUrls(chunk)) {
        if (seenUrls.has(url)) continue
        seenUrls.add(url)
        input.onAuthUrl?.(url)
      }
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => onOutput(chunk, 'stdout'))
    child.stderr.on('data', (chunk: string) => onOutput(chunk, 'stderr'))
    child.on('error', () => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      resolve({ code: 1, stdout, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', onAbort)
      resolve({ code: input.signal?.aborted === true ? 130 : timedOut ? 124 : code ?? 1, stdout, stderr })
    })
  })
}

export function extractCodexAuthUrls(text: string): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const candidate = match[0].replace(/[),.;]+$/, '')
    if (isSafeCodexAuthUrl(candidate)) urls.push(candidate)
  }
  return urls
}

function isSafeCodexAuthUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return false
    return SAFE_AUTH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

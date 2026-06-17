import { spawn } from 'node:child_process'

import type { ProcessResult } from '../runtime.js'
import { sanitizedEnv } from './codex.js'

export function storeTokenWithGh(token: string, env: Record<string, string | undefined>, signal?: AbortSignal): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn('gh', ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--with-token'], {
      env: sanitizedEnv(env),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const onAbort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', () => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: 1, stdout, stderr })
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ code: signal?.aborted === true ? 130 : code ?? 1, stdout, stderr })
    })
    child.stdin.end(`${token}\n`)
  })
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new Error('GitHub device authorization cancelled.'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

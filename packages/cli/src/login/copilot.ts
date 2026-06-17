import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProcessResult, RunProcess } from '../runtime.js'
import { sanitizedEnv } from './codex.js'
import { sleep, storeTokenWithGh } from './copilot-process.js'
const DEVICE_CODE_URL = 'https://github.com/login/device/code'
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_CLI_CLIENT_ID = '178c6fc778ccc68e1d6a'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const MAX_DEVICE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_INTERVAL_SECONDS = 5
const GITHUB_CLI_SCOPES = ['repo', 'read:org', 'gist']

export interface CopilotAuthResult {
  authenticated: boolean
  source?: string
}

export interface DeviceCodePrompt {
  userCode: string
  verificationUri: string
  expiresInSeconds: number
}

export class CopilotLoginError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'CopilotLoginError'
  }
}
export interface LoginCopilotDeviceFlowOptions {
  env: Record<string, string | undefined>
  runProcess: RunProcess
  fetch?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  jitterMs?: () => number
  onDeviceCode?: (prompt: DeviceCodePrompt) => void
  storeToken?: (token: string, env: Record<string, string | undefined>, signal?: AbortSignal) => Promise<ProcessResult>
}
interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval?: number
}

export async function detectExistingCopilot(input: {
  env: Record<string, string | undefined>
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<CopilotAuthResult | null> {
  for (const source of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    if (input.env[source]?.trim()) return { authenticated: true, source }
  }
  const status = await input.runProcess('gh', ['auth', 'status', '--hostname', 'github.com'], {
    env: sanitizedEnv(input.env),
    signal: input.signal,
    timeoutMs: 10_000,
  })
  if (status.code === 0) return { authenticated: true, source: 'gh auth status' }
  const hostsPath = join(input.env.HOME ?? homedir(), '.config', 'gh', 'hosts.yml')
  return existsSync(hostsPath) ? { authenticated: true, source: hostsPath } : null
}

export async function loginCopilotWithDeviceFlow(input: LoginCopilotDeviceFlowOptions): Promise<CopilotAuthResult> {
  await requireGh(input)
  const fetchFn = input.fetch ?? fetch
  const device = await requestDeviceCode(fetchFn)
  input.onDeviceCode?.({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSeconds: device.expires_in,
  })
  const token = await pollForToken(device, {
    fetchFn,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    sleep: input.sleep ?? sleep,
    jitterMs: input.jitterMs ?? (() => Math.floor(Math.random() * 250)),
  })
  const store = await (input.storeToken ?? storeTokenWithGh)(token, input.env, input.signal)
  if (store.code !== 0) throw new CopilotLoginError('auth_copilot_failed', 'GitHub token storage failed.')
  const status = await input.runProcess('gh', ['auth', 'status', '--hostname', 'github.com'], {
    env: sanitizedEnv(input.env),
    signal: input.signal,
    timeoutMs: 10_000,
  })
  if (status.code !== 0) throw new CopilotLoginError('auth_copilot_failed', 'GitHub authentication did not verify.')
  return { authenticated: true, source: 'gh auth status' }
}

async function requireGh(input: {
  env: Record<string, string | undefined>
  runProcess: RunProcess
  signal?: AbortSignal
}): Promise<void> {
  const result = await input.runProcess('gh', ['--version'], {
    env: sanitizedEnv(input.env),
    signal: input.signal,
    timeoutMs: 10_000,
  })
  if (result.code !== 0) throw new CopilotLoginError('auth_copilot_gh_not_installed', 'GitHub CLI is required.')
}

async function requestDeviceCode(fetchFn: typeof fetch): Promise<DeviceCodeResponse> {
  const response = await fetchFn(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GITHUB_CLI_CLIENT_ID, scope: GITHUB_CLI_SCOPES.join(' ') }),
  })
  const body = await parseJson(response)
  if (!response.ok || typeof body.device_code !== 'string') {
    throw new CopilotLoginError('auth_copilot_failed', 'GitHub device code request failed.')
  }
  return body as unknown as DeviceCodeResponse
}

async function pollForToken(device: DeviceCodeResponse, input: {
  fetchFn: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  jitterMs: () => number
}): Promise<string> {
  let intervalSeconds = Math.max(device.interval ?? DEFAULT_INTERVAL_SECONDS, 1)
  const timeoutMs = Math.min(input.timeoutMs ?? MAX_DEVICE_TIMEOUT_MS, device.expires_in * 1000, MAX_DEVICE_TIMEOUT_MS)
  const expiresAt = Date.now() + timeoutMs
  while (Date.now() < expiresAt) {
    await input.sleep(intervalSeconds * 1000 + input.jitterMs(), input.signal)
    const body = await pollOnce(input.fetchFn, device.device_code)
    if (typeof body.access_token === 'string') return body.access_token
    if (body.error === 'authorization_pending') continue
    if (body.error === 'slow_down') {
      intervalSeconds = nextSlowDownInterval(intervalSeconds, body.interval)
      continue
    }
    if (body.error === 'expired_token') {
      throw new CopilotLoginError('auth_copilot_device_code_expired', 'GitHub device authorization expired.')
    }
    throw new CopilotLoginError('auth_copilot_failed', 'GitHub device authorization failed.')
  }
  throw new CopilotLoginError('auth_copilot_device_code_timeout', 'GitHub device authorization timed out.')
}

async function pollOnce(fetchFn: typeof fetch, deviceCode: string): Promise<Record<string, unknown>> {
  const response = await fetchFn(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GITHUB_CLI_CLIENT_ID,
      device_code: deviceCode,
      grant_type: DEVICE_GRANT,
    }),
  })
  const body = await parseJson(response)
  if (!response.ok) throw new CopilotLoginError('auth_copilot_failed', 'GitHub device authorization failed.')
  return body
}

function nextSlowDownInterval(current: number, serverInterval: unknown): number {
  const parsed = typeof serverInterval === 'number' ? serverInterval : Number(serverInterval)
  return Math.max(Number.isFinite(parsed) ? parsed : current + 5, current + 5)
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = await response.json() as unknown
  } catch {
    throw new CopilotLoginError('auth_copilot_failed', 'GitHub returned an invalid OAuth response.')
  }
  if (parsed == null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new CopilotLoginError('auth_copilot_failed', 'GitHub returned an invalid OAuth response.')
  }
  return parsed as Record<string, unknown>
}

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'

export function ignoreBrokenPipe(stream) {
  stream.on('error', (error) => {
    if (error?.code !== 'EPIPE') {
      throw error
    }
  })
}

export function loadLocalEnv(options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = options.env ?? process.env
  const operatorTokenPath = options.operatorTokenPath ?? resolveOperatorTokenHomePath(env.HOME)
  const merged = {
    ...readEnvFile(resolve(cwd, '.env')),
    ...readEnvFile(resolve(cwd, '.env.local')),
  }
  if (!isUsableOperatorToken(merged.DUCTUM_OPERATOR_TOKEN)) {
    const homeToken = readOperatorTokenFile(operatorTokenPath)
    if (isUsableOperatorToken(homeToken)) {
      merged.DUCTUM_OPERATOR_TOKEN = homeToken
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (env[key] == null || env[key] === '') {
      env[key] = value
    }
  }
}

const PLACEHOLDER_OPERATOR_TOKENS = new Set([
  'missing',
  'changeme',
  'replace-me',
  'local-demo-token',
  'replace-me-with-a-long-random-token',
])

export function isUsableOperatorToken(value) {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' && !PLACEHOLDER_OPERATOR_TOKENS.has(trimmed.toLowerCase())
}

export async function ensureOperatorToken(options = {}) {
  const env = options.env ?? process.env
  const envPath = options.envPath ?? resolve('.env.local')
  const homeTokenPath = options.homeTokenPath
  const requested = options.requestedToken?.trim()
  const existing = env.DUCTUM_OPERATOR_TOKEN?.trim()
  const persistExisting = options.persistExisting === true

  if (requested == null && isUsableOperatorToken(existing)) {
    if (!persistExisting) {
      return { token: existing, action: 'existing', envPath, homeTokenPath, saved: false }
    }
    persistOperatorToken(existing, envPath, homeTokenPath)
    env.DUCTUM_OPERATOR_TOKEN = existing
    return { token: existing, action: 'existing', envPath, homeTokenPath, saved: true }
  }

  const token = await chooseOperatorToken({
    requested,
    generateToken: options.generateToken ?? generateOperatorToken,
    input: options.input ?? process.stdin,
    output: options.output ?? process.stdout,
  })
  if (!isUsableOperatorToken(token)) {
    throw new Error('DUCTUM_OPERATOR_TOKEN must not be empty or a placeholder value')
  }
  if (/[\r\n]/.test(token)) {
    throw new Error('DUCTUM_OPERATOR_TOKEN must be a single-line value')
  }

  persistOperatorToken(token, envPath, homeTokenPath)
  env.DUCTUM_OPERATOR_TOKEN = token
  return {
    token,
    action: requested != null && requested !== '' && requested !== 'auto' ? 'chosen' : 'generated',
    envPath,
    homeTokenPath,
    saved: true,
  }
}

export function resolveOperatorTokenHomePath(home = process.env.HOME ?? homedir()) {
  return resolve(home, '.ductum/operator-token')
}

export function readOperatorTokenFile(path) {
  if (!existsSync(path)) return null
  const value = readFileSync(path, 'utf-8').trim()
  return value === '' ? null : value
}

export function resolveEnvVars(obj) {
  if (obj == null) return obj
  if (typeof obj === 'string') {
    return obj.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '')
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) result[key] = resolveEnvVars(value)
    return result
  }
  return obj
}

export function createApiCall(apiUrl, operatorToken) {
  return async function apiCall(method, path, body) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(operatorToken ? { 'X-Ductum-Operator-Token': operatorToken } : {}),
      },
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${apiUrl}${path}`, opts)
    if (!res.ok && res.status !== 409) {
      const text = await res.text()
      throw new Error(`${method} ${path}: ${res.status} ${text}`)
    }
    return res.json()
  }
}

export async function waitForApi(apiUrl, maxWait = 10000) {
  const start = Date.now()
  while (Date.now() - start < maxWait) {
    try {
      await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(500) })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return false
}

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const values = {}
  const text = readFileSync(path, 'utf-8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match == null) continue
    const [, key, rawValue] = match
    if (key == null || rawValue == null) continue
    values[key] = unquoteEnvValue(rawValue.trim())
  }
  return values
}

async function chooseOperatorToken({ requested, generateToken, input, output }) {
  if (requested === 'prompt') {
    const rl = createInterface({ input, output })
    try {
      const answer = await rl.question('No usable DUCTUM_OPERATOR_TOKEN found. Paste one, or press Enter to auto-generate: ')
      const trimmed = answer.trim()
      return trimmed === '' ? generateToken() : trimmed
    } finally {
      rl.close()
    }
  }
  if (requested != null && requested !== '' && requested !== 'auto') return requested
  return generateToken()
}

function generateOperatorToken() {
  return randomBytes(32).toString('hex')
}

export function writeEnvValue(path, key, value) {
  const line = `${key}=${value}`
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${line}\n`, { mode: 0o600 })
    return
  }

  const text = readFileSync(path, 'utf-8')
  const lines = text.split(/\r?\n/)
  let replaced = false
  const next = lines.map((rawLine) => {
    if (new RegExp(`^\\s*${key}\\s*=`).test(rawLine)) {
      replaced = true
      return line
    }
    return rawLine
  })
  if (!replaced) {
    if (next.length > 0 && next[next.length - 1] !== '') next.push('')
    next.push(line)
  }
  writeFileSync(path, next.join('\n').replace(/\n*$/, '\n'))
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort: startup should not fail only because chmod is unavailable.
  }
}

export function writeSecretValue(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${value.trim()}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best effort: startup should not fail only because chmod is unavailable.
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function persistOperatorToken(token, envPath, homeTokenPath) {
  writeEnvValue(envPath, 'DUCTUM_OPERATOR_TOKEN', token)
  if (homeTokenPath != null && homeTokenPath !== '') {
    writeSecretValue(homeTokenPath, token)
  }
}

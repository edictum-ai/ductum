import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { resolveImplicitFactoryDataDir } from './serve/factory-discovery.js'
import { readUserConfig, readUserOperatorToken, normalizeApiUrl } from './user-config.js'

export function loadLocalEnv({
  cwd = process.cwd(),
  env = process.env,
}: {
  cwd?: string
  env?: Record<string, string | undefined>
} = {}): string[] {
  const shellKeys = new Set(
    Object.entries(env)
      .filter(([, value]) => value != null && value.trim() !== '')
      .map(([key]) => key),
  )
  const protectedKeys = new Set(shellKeys)
  const loaded = new Set<string>()
  loadEnvFiles(cwd, env, protectedKeys, loaded)
  for (const key of loaded) {
    if (key === 'DUCTUM_API_URL' || key === 'DUCTUM_OPERATOR_TOKEN') continue
    protectedKeys.add(key)
  }

  if (!shellKeys.has('DUCTUM_OPERATOR_TOKEN')) {
    const homeToken = readUserOperatorToken(env)
    if (isUsableOperatorToken(homeToken)) {
      env.DUCTUM_OPERATOR_TOKEN = homeToken
      loaded.add('DUCTUM_OPERATOR_TOKEN')
      protectedKeys.add('DUCTUM_OPERATOR_TOKEN')
    } else if (isUsableOperatorToken(env.DUCTUM_OPERATOR_TOKEN)) {
      protectedKeys.add('DUCTUM_OPERATOR_TOKEN')
    }
  }
  if (!shellKeys.has('DUCTUM_API_URL')) {
    const configuredApiUrl = readUserConfig(env).apiUrl
    if (configuredApiUrl != null) {
      env.DUCTUM_API_URL = configuredApiUrl
      loaded.add('DUCTUM_API_URL')
      protectedKeys.add('DUCTUM_API_URL')
    } else if (isNonEmpty(env.DUCTUM_API_URL)) {
      protectedKeys.add('DUCTUM_API_URL')
    }
  }

  const factoryDir = resolveImplicitFactoryDataDir(env)
  const factoryLoaded = new Set<string>()
  if (factoryDir != null && resolve(factoryDir) !== resolve(cwd)) {
    loadEnvFiles(factoryDir, env, protectedKeys, factoryLoaded)
    for (const key of factoryLoaded) loaded.add(key)
  }

  if (!protectedKeys.has('DUCTUM_OPERATOR_TOKEN') && !isUsableOperatorToken(env.DUCTUM_OPERATOR_TOKEN)) {
    const factoryToken = factoryDir == null ? undefined : readTokenFile(join(factoryDir, '.ductum', 'operator-token'))
    if (isUsableOperatorToken(factoryToken)) {
      env.DUCTUM_OPERATOR_TOKEN = factoryToken
      loaded.add('DUCTUM_OPERATOR_TOKEN')
    }
  }
  return [...loaded]
}

export function resolveCliApiUrl(
  explicitApiUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  if (isNonEmpty(explicitApiUrl)) return normalizeApiUrl(explicitApiUrl)
  if (isNonEmpty(env.DUCTUM_API_URL)) return normalizeApiUrl(env.DUCTUM_API_URL)
  const host = normalizeClientHost(env.DUCTUM_HOST?.trim() || 'localhost')
  const port = env.DUCTUM_PORT?.trim() || '4100'
  if (!/^\d+$/.test(port)) throw new Error(`DUCTUM_PORT must be numeric, got: ${port}`)
  return `http://${host}:${port}`
}

function loadEnvFiles(
  cwd: string,
  env: Record<string, string | undefined>,
  protectedKeys: Set<string>,
  loaded: Set<string>,
): void {
  for (const file of ['.env', '.env.local']) {
    const path = `${cwd}/${file}`
    if (!existsSync(path)) continue
    for (const [key, value] of Object.entries(parseEnvFile(readFileSync(path, 'utf8')))) {
      if (protectedKeys.has(key)) continue
      env[key] = value
      loaded.add(key)
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

function isUsableOperatorToken(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed != null && trimmed !== '' && !PLACEHOLDER_OPERATOR_TOKENS.has(trimmed.toLowerCase())
}

function isNonEmpty(value: string | undefined): value is string {
  return value != null && value.trim() !== ''
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

function readTokenFile(tokenPath: string): string | undefined {
  if (!existsSync(tokenPath)) return undefined
  const value = readFileSync(tokenPath, 'utf8').trim()
  return value === '' ? undefined : value
}

function normalizeClientHost(host: string): string {
  if (host === '' || host === '0.0.0.0') return '127.0.0.1'
  if (host === '::' || host === '[::]') return '[::1]'
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`
  return host
}

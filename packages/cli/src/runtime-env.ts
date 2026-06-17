import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { resolveImplicitFactoryDataDir } from './serve/factory-discovery.js'

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
  loadEnvFiles(cwd, env, protectedKeys, loaded)

  const factoryDir = resolveImplicitFactoryDataDir(env)
  const factoryLoaded = new Set<string>()
  if (factoryDir != null && resolve(factoryDir) !== resolve(cwd)) {
    loadEnvFiles(factoryDir, env, protectedKeys, factoryLoaded)
    for (const key of factoryLoaded) loaded.add(key)
  }

  if (!protectedKeys.has('DUCTUM_OPERATOR_TOKEN')) {
    const factoryEnvToken = factoryLoaded.has('DUCTUM_OPERATOR_TOKEN') && isUsableOperatorToken(env.DUCTUM_OPERATOR_TOKEN)
    if (!factoryEnvToken) {
      const factoryToken = factoryDir == null ? undefined : readTokenFile(join(factoryDir, '.ductum', 'operator-token'))
      if (isUsableOperatorToken(factoryToken)) {
        env.DUCTUM_OPERATOR_TOKEN = factoryToken
        loaded.add('DUCTUM_OPERATOR_TOKEN')
      } else if (!isUsableOperatorToken(env.DUCTUM_OPERATOR_TOKEN)) {
        const homeToken = readTokenFile(join(env.HOME?.trim() || homedir(), '.ductum', 'operator-token'))
        if (isUsableOperatorToken(homeToken)) {
          env.DUCTUM_OPERATOR_TOKEN = homeToken
          loaded.add('DUCTUM_OPERATOR_TOKEN')
        }
      }
    }
  }
  return [...loaded]
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

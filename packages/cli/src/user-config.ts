import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export interface DuctumUserConfig {
  apiUrl?: string
}

export function ductumHome(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.DUCTUM_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.ductum'))
}

export function userConfigPath(env: Record<string, string | undefined> = process.env): string {
  return join(ductumHome(env), 'config.json')
}

export function userOperatorTokenPath(env: Record<string, string | undefined> = process.env): string {
  return join(ductumHome(env), 'operator-token')
}

export function readUserConfig(env: Record<string, string | undefined> = process.env): DuctumUserConfig {
  const path = userConfigPath(env)
  if (!existsSync(path)) return {}
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const record = parsed as Record<string, unknown>
  return {
    ...(typeof record.apiUrl === 'string' && record.apiUrl.trim() !== ''
      ? { apiUrl: normalizeApiUrl(record.apiUrl) }
      : {}),
  }
}

export function writeUserConfig(config: DuctumUserConfig, env: Record<string, string | undefined> = process.env): string {
  const home = ductumHome(env)
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const path = userConfigPath(env)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodBestEffort(path, 0o600)
  return path
}

export function setUserApiUrl(apiUrl: string, env: Record<string, string | undefined> = process.env): string {
  const config = readUserConfig(env)
  return writeUserConfig({ ...config, apiUrl: normalizeApiUrl(apiUrl) }, env)
}

export function setUserOperatorToken(token: string, env: Record<string, string | undefined> = process.env): string {
  const trimmed = token.trim()
  if (trimmed === '') throw new Error('Operator token cannot be empty')
  const home = ductumHome(env)
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const path = userOperatorTokenPath(env)
  writeFileSync(path, `${trimmed}\n`, { mode: 0o600 })
  chmodBestEffort(path, 0o600)
  return path
}

export function readUserOperatorToken(env: Record<string, string | undefined> = process.env): string | undefined {
  const path = userOperatorTokenPath(env)
  if (!existsSync(path)) return undefined
  const token = readFileSync(path, 'utf8').trim()
  return token === '' ? undefined : token
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('API URL cannot be empty')
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Invalid API URL: ${value}`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`API URL must use http or https: ${value}`)
  }
  return parsed.toString().replace(/\/+$/, '')
}

function chmodBestEffort(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Best effort for non-POSIX filesystems.
  }
}

import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { OAuthCredentials } from './pkce-core.js'

export function resolveClaudeCredentialsPath(env: Record<string, string | undefined>): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim()
  if (configured != null && configured !== '') return join(configured, 'credentials.json')
  return join(env.HOME ?? homedir(), '.claude', '.credentials.json')
}

export function readClaudeCredentials(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return hasClaudeCredential(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeClaudeCredentials(path: string, credentials: OAuthCredentials): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.credentials.${process.pid}.${Date.now()}.tmp`)
  const text = `${JSON.stringify({
    claudeAiOauth: {
      accessToken: credentials.access,
      refreshToken: credentials.refresh,
      expiresAt: credentials.expires,
    },
  }, null, 2)}\n`
  try {
    await writeFile(tmp, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(tmp, path)
    await chmod(path, 0o600)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

export function hasClaudeCredential(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const key of ['accessToken', 'access_token', 'refreshToken', 'refresh_token']) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return true
  }
  return Object.values(record).some(hasClaudeCredential)
}

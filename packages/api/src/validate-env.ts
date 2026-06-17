/**
 * Conditional environment variable validation.
 *
 * Validates required env vars based on which harnesses and dispatch modes
 * are configured in DB-backed Factory Settings. Only checks what's actually
 * needed.
 *
 * Note: DUCTUM_REPO_PATH_MAP is set by serve.mjs dynamically — NOT
 * required as an env var. It's an internal channel between serve.mjs
 * and the API process.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

import { log } from '@ductum/core'

export interface DuctumAgentConfig {
  harness: string
  [key: string]: unknown
}

export interface DuctumConfig {
  agents: Record<string, DuctumAgentConfig>
  port?: number
  [key: string]: unknown
}

export function validateEnv(config: DuctumConfig): void {
  const errors: string[] = []

  // Only require Anthropic auth if any agent uses claude-agent-sdk harness.
  // D130: subscription auth is valid; do not over-check raw API keys.
  // D159: ambient credentials in ~/.claude/.credentials.json (PKCE output)
  // are accepted in addition to env vars, mirroring bootstrap-support.mjs.
  const hasClaude = Object.values(config.agents).some(a => a.harness === 'claude-agent-sdk')
  if (hasClaude && !hasAnthropicAuth()) {
    errors.push(
      'Anthropic auth is required for claude-agent-sdk agents: set ANTHROPIC_OAUTH_TOKEN, ANTHROPIC_AUTH_TOKEN, CLAUDE_CODE_OAUTH_TOKEN, or ANTHROPIC_API_KEY, or sign in with Claude Code so ~/.claude/.credentials.json exists',
    )
  }

  // Only require OPENCODE_URL check if any agent uses opencode harness
  const hasOpenCode = Object.values(config.agents).some(a => a.harness === 'opencode')
  if (hasOpenCode) {
    // Warn if OpenCode isn't reachable (non-fatal — it might start later)
    log.warn('startup', 'OpenCode harness configured — ensure opencode serve is running')
  }

  // Port validation (only if set)
  const port = process.env.DUCTUM_PORT
  if (port && (isNaN(Number(port)) || Number(port) < 1 || Number(port) > 65535)) {
    errors.push(`DUCTUM_PORT must be a valid port number, got: ${port}`)
  }

  if (errors.length > 0) {
    log.error('startup', 'Startup validation failed:')
    for (const e of errors) {
      log.error('startup', `  - ${e}`)
    }
    process.exit(1)
  }
}

function hasAnthropicAuth(): boolean {
  const envHit = [
    process.env.ANTHROPIC_OAUTH_TOKEN,
    process.env.ANTHROPIC_AUTH_TOKEN,
    process.env.CLAUDE_CODE_OAUTH_TOKEN,
    process.env.ANTHROPIC_API_KEY,
  ].some((value) => value != null && value.trim() !== '')
  if (envHit) return true
  return claudeCredentialPaths().some(hasClaudeCredentialFile)
}

function claudeCredentialPaths(): string[] {
  const paths = [resolve(homedir(), '.claude', '.credentials.json')]
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
  if (configDir != null && configDir !== '') {
    paths.push(resolve(configDir, 'credentials.json'))
  }
  return [...new Set(paths)]
}

function hasClaudeCredentialFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    return hasCredentialValue(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return false
  }
}

function hasCredentialValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim() !== ''
  if (value == null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  for (const key of [
    'ANTHROPIC_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'accessToken',
    'access_token',
    'oauthToken',
    'refreshToken',
    'refresh_token',
  ]) {
    const child = record[key]
    if (typeof child === 'string' && child.trim() !== '') return true
  }
  return Object.values(record).some(hasCredentialValue)
}

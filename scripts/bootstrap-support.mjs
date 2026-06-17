import { openSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000
export const BOOTSTRAP_STATE_RELATIVE_PATH = '.ductum/bootstrap/latest.json'
export const BOOTSTRAP_LOG_RELATIVE_PATH = '.ductum/bootstrap/serve.log'

export async function checkBootstrapPrerequisites(env = process.env) {
  const issues = []

  if (!versionAtLeast(process.versions.node, '22.0.0')) {
    issues.push('Install Node.js 22+ from https://nodejs.org/ then rerun pnpm bootstrap')
  }

  try {
    const { stdout } = await execFileAsync('pnpm', ['--version'], { encoding: 'utf-8' })
    if (!versionAtLeast(stdout.trim(), '10.0.0')) {
      issues.push('Install pnpm 10+: corepack enable && corepack prepare pnpm@10.11.0 --activate')
    }
  } catch {
    issues.push('Install pnpm 10+: corepack enable && corepack prepare pnpm@10.11.0 --activate')
  }

  const providers = await resolveProviders(env)
  if (providers.length === 0) {
    issues.push(formatAcceptedCredentialHelp())
  }

  return issues
}

// Auth detection ported from the pi-mono env-api-keys pattern
// (https://github.com/badlogic/pi-mono, MIT). Ductum keeps the provider
// table local so bootstrap can validate the operator environment without
// taking a runtime dependency on pi.
const API_KEY_ENV_VARS = {
  anthropic: ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
  zai: ['ZAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
}

const PROVIDER_LABELS = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  copilot: 'GitHub Copilot',
  zai: 'Z.AI',
  openrouter: 'OpenRouter',
}

export function getApiKeyEnvVars() {
  return Object.fromEntries(
    Object.entries(API_KEY_ENV_VARS).map(([provider, envVars]) => [provider, [...envVars]]),
  )
}

export function findEnvKeys(env = process.env) {
  const found = {}
  for (const [provider, envVars] of Object.entries(API_KEY_ENV_VARS)) {
    for (const name of envVars) {
      const value = env[name]?.trim()
      if (value == null || value === '') continue
      found[provider] ??= []
      found[provider].push({
        provider,
        label: PROVIDER_LABELS[provider] ?? provider,
        sourceType: 'env',
        source: name,
        value: maskSecret(value),
      })
    }
  }
  return found
}

export async function findAmbientCreds(options = {}) {
  const env = options.env ?? process.env
  const home = options.home ?? env.HOME ?? homedir()
  const exec = options.execFileAsync ?? execFileAsync
  const ghAuthTimeoutMs = options.ghAuthTimeoutMs ?? GH_AUTH_STATUS_TIMEOUT_MS
  const found = {}

  for (const path of claudeCredentialPaths(env, home)) {
    if (hasClaudeCredentialFile(path)) {
      found.anthropic ??= []
      found.anthropic.push(ambientCredential('anthropic', path, 'filesystem'))
    }
  }

  const ghStatus = await detectGhAuthStatus(exec, ghAuthTimeoutMs)
  if (ghStatus != null) {
    found.copilot ??= []
    found.copilot.push(ambientCredential('copilot', ghStatus, 'gh'))
  }

  const hostsPath = resolve(home, '.config', 'gh', 'hosts.yml')
  if (hasGithubHostsToken(hostsPath)) {
    found.copilot ??= []
    found.copilot.push(ambientCredential('copilot', hostsPath, 'filesystem'))
  }

  return found
}

export async function resolveProviders(env = process.env, options = {}) {
  const byProvider = new Map()
  for (const [provider, entries] of Object.entries(findEnvKeys(env))) {
    if (entries[0] != null) byProvider.set(provider, entries[0])
  }
  const ambient = await findAmbientCreds({ ...options, env })
  for (const [provider, entries] of Object.entries(ambient)) {
    if (!byProvider.has(provider) && entries[0] != null) {
      byProvider.set(provider, entries[0])
    }
  }
  return [...byProvider.values()]
}

export function formatProviderSource(provider) {
  return `${provider.label} via ${provider.source}`
}

export function formatAcceptedCredentialHelp() {
  const envLines = Object.entries(API_KEY_ENV_VARS).flatMap(([provider, vars]) =>
    vars.map((name) => `  export ${name}=<${provider}-credential>`),
  )
  return [
    'No agent provider credential found.',
    '',
    'Accepted environment variables:',
    ...envLines,
    '',
    'Accepted ambient credentials:',
    '  ~/.claude/.credentials.json',
    '  $CLAUDE_CONFIG_DIR/credentials.json',
    '  gh auth status',
    '  ~/.config/gh/hosts.yml',
    '',
    'For Claude subscription auth, sign in with Claude Code or provide one of the supported Anthropic environment variables, then rerun.',
  ].join('\n')
}

function claudeCredentialPaths(env, home) {
  const paths = [resolve(home, '.claude', '.credentials.json')]
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  if (configDir != null && configDir !== '') {
    paths.push(resolve(configDir, 'credentials.json'))
  }
  return [...new Set(paths)]
}

function hasClaudeCredentialFile(path) {
  if (!existsSync(path)) return false
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return hasCredentialValue(parsed)
  } catch {
    return false
  }
}

function hasCredentialValue(value) {
  if (typeof value === 'string') return value.trim() !== ''
  if (value == null || typeof value !== 'object') return false
  const record = value
  for (const key of [
    'ANTHROPIC_OAUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'accessToken',
    'access_token',
    'oauthToken',
    'refreshToken',
    'refresh_token',
  ]) {
    if (typeof record[key] === 'string' && record[key].trim() !== '') return true
  }
  return Object.values(record).some(hasCredentialValue)
}

// `gh auth status` can hang indefinitely (slow network, prompting keyring,
// stuck credential helper). Bootstrap must never block on ambient auth
// detection, so the call is bounded by GH_AUTH_STATUS_TIMEOUT_MS. On timeout we
// treat GitHub ambient auth as absent and let provider resolution continue.
export const GH_AUTH_STATUS_TIMEOUT_MS = 2000

const GH_LOGGED_IN_PATTERN = /logged in to github\.com|github\.com\s+✓|token:/i

async function detectGhAuthStatus(exec, timeoutMs = GH_AUTH_STATUS_TIMEOUT_MS) {
  const outcome = await callWithTimeout(
    // The `timeout` option lets node kill a real hung `gh` child so it does not
    // outlive bootstrap; the JS race below is the authoritative bound.
    () => exec('gh', ['auth', 'status'], { encoding: 'utf-8', timeout: timeoutMs }),
    timeoutMs,
  )
  if (outcome.timedOut) return null
  const result = outcome.ok ? outcome.value : outcome.error
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`
  return GH_LOGGED_IN_PATTERN.test(text) ? 'gh auth status' : null
}

// Race a thunk against a deadline. Resolves to { timedOut: true } if the
// deadline wins, { ok: true, value } on success, or { ok: false, error } on
// rejection. Never rejects, so callers can branch without a try/catch.
async function callWithTimeout(start, timeoutMs) {
  let timer
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs)
    timer.unref?.()
  })
  try {
    return await Promise.race([
      Promise.resolve().then(start).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function hasGithubHostsToken(path) {
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf-8')
  return /^\s*(oauth_token|user|git_protocol):/m.test(text) && /^\s*oauth_token:\s*\S+/m.test(text)
}

function ambientCredential(provider, source, sourceType) {
  return {
    provider,
    label: PROVIDER_LABELS[provider] ?? provider,
    sourceType,
    source,
    value: '<authenticated>',
  }
}

function maskSecret(value) {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '<set>'
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

export function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual)
  const right = parseVersion(minimum)
  if (left == null || right == null) return false
  if (left.major !== right.major) return left.major > right.major
  if (left.minor !== right.minor) return left.minor > right.minor
  return left.patch >= right.patch
}

export function parseVersion(value) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value)
  if (match?.[1] == null || match[2] == null || match[3] == null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export async function runCommand(command, args, options = {}) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
    })
    child.on('error', rejectPromise)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

export async function runJsonCommand(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: 'utf-8',
  })
  try {
    return JSON.parse(stdout)
  } catch (error) {
    const suffix = stderr.trim() === '' ? '' : `\nSTDERR:\n${stderr.trim()}`
    throw new Error(`Failed to parse JSON from ${command} ${args.join(' ')}: ${error instanceof Error ? error.message : String(error)}${suffix}`)
  }
}

export function writeBootstrapState(root, state) {
  const path = resolve(root, BOOTSTRAP_STATE_RELATIVE_PATH)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`)
  return path
}

export function readBootstrapState(root = process.cwd()) {
  const path = resolve(root, BOOTSTRAP_STATE_RELATIVE_PATH)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

export function spawnDetachedProcess(command, args, options = {}) {
  const logPath = resolve(options.cwd ?? process.cwd(), options.logPath ?? BOOTSTRAP_LOG_RELATIVE_PATH)
  mkdirSync(dirname(logPath), { recursive: true })
  const fd = openSync(logPath, 'a')
  const child = spawn(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  child.unref()
  return { pid: child.pid, logPath }
}

export async function waitForCondition(check, options = {}) {
  const timeoutMs = options.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? 1000
  const startedAt = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(options.timeoutMessage ?? `Timed out after ${timeoutMs}ms`)
    }
    await sleep(intervalMs)
  }
}

export function tailFile(path, maxChars = 4000) {
  if (!existsSync(path)) return '(log file not found)'
  const text = readFileSync(path, 'utf-8')
  return text.length <= maxChars ? text : text.slice(-maxChars)
}

export function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

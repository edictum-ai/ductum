import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

const FALLBACK_EXECUTABLE_PATHS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
]

export function spawnCodexAppServer(
  workingDir: string,
  env: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  const launchEnv = buildCodexLaunchEnv(workingDir, env)
  return spawn(launchEnv.DUCTUM_CODEX_COMMAND?.trim() || 'codex', [
    'app-server',
    '--listen',
    'stdio://',
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workingDir,
    env: launchEnv,
  })
}

export function buildCodexLaunchEnv(workingDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_HOME: prepareCodexHome(workingDir, env),
    PATH: appendFallbackExecutablePaths(env.PATH ?? process.env.PATH ?? ''),
  }
}

function prepareCodexHome(workingDir: string, env: NodeJS.ProcessEnv): string {
  const codexHome = resolve(env.DUCTUM_CODEX_HOME?.trim() || join(dirname(workingDir), '.codex-home', safePathSegment(env.DUCTUM_RUN_ID)))
  mkdirSync(codexHome, { recursive: true, mode: 0o700 })

  const configPath = join(codexHome, 'config.toml')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, '# Isolated Ductum worker config. Per-run MCP is injected by thread config.\n', { mode: 0o600 })
  }

  const sourceHome = resolve(env.DUCTUM_SOURCE_CODEX_HOME?.trim() || env.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  linkAuthFile(sourceHome, codexHome, 'auth.json')
  return codexHome
}

function linkAuthFile(sourceHome: string, codexHome: string, fileName: string): void {
  const source = join(sourceHome, fileName)
  const target = join(codexHome, fileName)
  if (!existsSync(source) || existsSync(target) || resolve(source) === resolve(target)) return
  try {
    symlinkSync(source, target)
  } catch {
    copyFileSync(source, target)
  }
}

function safePathSegment(value: string | undefined): string {
  const segment = value?.trim().replace(/[^A-Za-z0-9_.-]/g, '_')
  return segment && segment.length > 0 ? segment : 'default'
}

function appendFallbackExecutablePaths(value: string): string {
  const parts = value.split(delimiter).filter(Boolean)
  for (const path of FALLBACK_EXECUTABLE_PATHS) {
    if (!parts.includes(path)) parts.push(path)
  }
  return parts.join(delimiter)
}

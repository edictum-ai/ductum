import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import type { PreparedSandboxRuntime } from '@ductum/core'

import { spawnInPodmanSandbox } from './podman-exec.js'
import { spawnHostExternalCliProcess, type HostProcessLaunch } from './process-tree-cleanup.js'

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
  sandbox?: PreparedSandboxRuntime,
): HostProcessLaunch {
  if (sandbox?.driver === 'container') {
    const launchEnv = buildCodexContainerLaunchEnv(sandbox, env)
    return {
      child: spawnInPodmanSandbox(sandbox, launchEnv.DUCTUM_CODEX_COMMAND?.trim() || 'codex', [
        'app-server',
        '--listen',
        'stdio://',
      ], launchEnv),
      ownership: { kind: 'direct-child', pid: null, unsupportedReason: 'podman cleanup is container-managed' },
    }
  }
  const launchEnv = buildCodexLaunchEnv(workingDir, env)
  return spawnHostExternalCliProcess(launchEnv.DUCTUM_CODEX_COMMAND?.trim() || 'codex', [
    'app-server',
    '--listen',
    'stdio://',
  ], {
    cwd: workingDir,
    env: launchEnv,
  })
}

export function buildCodexLaunchEnv(workingDir: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_HOME: prepareCodexHome(resolve(env.DUCTUM_CODEX_HOME?.trim() || join(dirname(workingDir), '.codex-home', safePathSegment(env.DUCTUM_RUN_ID))), env, 'link'),
    PATH: appendFallbackExecutablePaths(env.PATH ?? process.env.PATH ?? ''),
  }
}

export function buildCodexContainerLaunchEnv(sandbox: PreparedSandboxRuntime, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const runtimeHostDir = sandbox.podman?.runtimeHostDir
  const runtimeDir = sandbox.podman?.runtimeDir
  if (runtimeHostDir == null || runtimeDir == null) {
    throw new Error('Podman sandbox execution requires a mounted runtime directory')
  }
  const hostCodexHome = join(runtimeHostDir, 'codex-home')
  const containerCodexHome = `${runtimeDir.replace(/\/+$/, '')}/codex-home`
  prepareCodexHome(hostCodexHome, env, 'scoped-copy')
  return {
    ...buildScopedContainerEnv(env),
    CODEX_HOME: containerCodexHome,
    DUCTUM_CODEX_CONTAINERIZED: '1',
    DUCTUM_CONTAINER_HOST_ALIAS: env.DUCTUM_CONTAINER_HOST_ALIAS?.trim() || 'host.containers.internal',
    PATH: appendFallbackExecutablePaths(env.PATH ?? process.env.PATH ?? ''),
  }
}

const CODEX_CONTAINER_ENV_ALLOWLIST = new Set([
  'DUCTUM_API_URL', 'DUCTUM_CONTROL_TOKEN', 'DUCTUM_RUN_ID', 'DUCTUM_CODEX_COMMAND',
  'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'TMPDIR', 'TEMP', 'TMP',
])

function buildScopedContainerEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (value != null && CODEX_CONTAINER_ENV_ALLOWLIST.has(key)) safeEnv[key] = value
  }
  return safeEnv
}

function prepareCodexHome(codexHome: string, env: NodeJS.ProcessEnv, authMode: 'scoped-copy' | 'link'): string {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 })

  const configPath = join(codexHome, 'config.toml')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, '# Isolated Ductum worker config. Per-run MCP is injected by thread config.\n', { mode: 0o600 })
  }

  const sourceHome = resolveCodexAuthSource(env, authMode)
  if (sourceHome != null) installAuthFile(sourceHome, codexHome, 'auth.json', authMode)
  return codexHome
}

function resolveCodexAuthSource(env: NodeJS.ProcessEnv, authMode: 'scoped-copy' | 'link'): string | null {
  if (authMode === 'scoped-copy') {
    const scopedHome = env.DUCTUM_SCOPED_CODEX_HOME?.trim()
    if (scopedHome != null && scopedHome !== '') return resolve(scopedHome)
    if (env.OPENAI_API_KEY?.trim() || env.CODEX_API_KEY?.trim()) return null
    throw new Error('Podman Codex execution requires OPENAI_API_KEY, CODEX_API_KEY, or DUCTUM_SCOPED_CODEX_HOME for scoped credentials')
  }
  return resolve(env.DUCTUM_SOURCE_CODEX_HOME?.trim() || env.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
}

function installAuthFile(sourceHome: string, codexHome: string, fileName: string, mode: 'scoped-copy' | 'link'): void {
  const source = join(sourceHome, fileName)
  const target = join(codexHome, fileName)
  if (!existsSync(source) || existsSync(target) || resolve(source) === resolve(target)) return
  if (mode === 'scoped-copy') {
    copyFileSync(source, target)
    return
  }
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

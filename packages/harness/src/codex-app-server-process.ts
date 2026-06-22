import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import type { PreparedSandboxRuntime } from '@ductum/core'

import { spawnInPodmanSandbox } from './podman-exec.js'

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
): ChildProcessWithoutNullStreams {
  if (sandbox?.driver === 'container') {
    const launchEnv = buildCodexContainerLaunchEnv(sandbox, env)
    return spawnInPodmanSandbox(sandbox, launchEnv.DUCTUM_CODEX_COMMAND?.trim() || 'codex', [
      'app-server',
      '--listen',
      'stdio://',
    ], launchEnv)
  }
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
  prepareCodexHome(hostCodexHome, env, 'copy')
  return {
    ...env,
    CODEX_HOME: containerCodexHome,
    DUCTUM_CODEX_CONTAINERIZED: '1',
    DUCTUM_CONTAINER_HOST_ALIAS: env.DUCTUM_CONTAINER_HOST_ALIAS?.trim() || 'host.containers.internal',
    PATH: appendFallbackExecutablePaths(env.PATH ?? process.env.PATH ?? ''),
  }
}

function prepareCodexHome(codexHome: string, env: NodeJS.ProcessEnv, authMode: 'copy' | 'link'): string {
  mkdirSync(codexHome, { recursive: true, mode: 0o700 })

  const configPath = join(codexHome, 'config.toml')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, '# Isolated Ductum worker config. Per-run MCP is injected by thread config.\n', { mode: 0o600 })
  }

  const sourceHome = resolve(env.DUCTUM_SOURCE_CODEX_HOME?.trim() || env.CODEX_HOME?.trim() || process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  installAuthFile(sourceHome, codexHome, 'auth.json', authMode)
  return codexHome
}

function installAuthFile(sourceHome: string, codexHome: string, fileName: string, mode: 'copy' | 'link'): void {
  const source = join(sourceHome, fileName)
  const target = join(codexHome, fileName)
  if (!existsSync(source) || existsSync(target) || resolve(source) === resolve(target)) return
  if (mode === 'copy') {
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

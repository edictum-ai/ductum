import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { delimiter } from 'node:path'

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
  const launchEnv = buildCodexLaunchEnv(env)
  return spawn(launchEnv.DUCTUM_CODEX_COMMAND?.trim() || 'codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workingDir,
    env: launchEnv,
  })
}

export function buildCodexLaunchEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: appendFallbackExecutablePaths(env.PATH ?? process.env.PATH ?? ''),
  }
}

function appendFallbackExecutablePaths(value: string): string {
  const parts = value.split(delimiter).filter(Boolean)
  for (const path of FALLBACK_EXECUTABLE_PATHS) {
    if (!parts.includes(path)) parts.push(path)
  }
  return parts.join(delimiter)
}

import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import type { WorkspacePreflightProbes } from './workspace-preflight-types.js'

/**
 * Default host probe implementation for the workspace preflight. Uses
 * sync filesystem and child_process calls; the runner is bounded by the
 * configured checks (no long-running commands). Each call is wrapped so
 * a probe error becomes a check failure rather than crashing the
 * dispatcher.
 */
export function createHostPreflightProbes(hostEnv: NodeJS.ProcessEnv | undefined): WorkspacePreflightProbes {
  const env = hostEnv ?? process.env
  return {
    hasBinary(name) {
      return resolveExecutable(name, env) != null
    },
    binaryVersion(name) {
      try {
        const executable = resolveExecutable(name, env) ?? name
        const out = execFileSync(executable, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', timeout: 5_000, env })
        return out.trim().split(/\r?\n/)[0] ?? null
      } catch {
        return null
      }
    },
    exists(path) {
      try {
        return existsSync(path)
      } catch {
        return false
      }
    },
    isWritable(path) {
      try {
        accessSync(path, constants.W_OK)
        return true
      } catch {
        return false
      }
    },
    worktreeStatus(path) {
      try {
        if (!isInsideGitWorktree(path)) {
          return { clean: false, error: 'path is not inside a Git worktree' }
        }
        const out = execFileSync('git', ['-C', path, 'status', '--porcelain'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', timeout: 5_000 })
        return { clean: out.trim() === '', error: null }
      } catch (error) {
        return { clean: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    envValue(name) {
      const value = env[name]
      return value == null || value === '' ? undefined : value
    },
  }
}

function resolveExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env.PATH ?? ''
  const direct = name.includes('/') || name.includes('\\')
  if (direct) return canExecute(name) ? name : null
  const extensions = process.platform === 'win32' ? windowsExtensions(name, env) : ['']
  for (const dir of pathValue.split(delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = join(dir, `${name}${extension}`)
      if (canExecute(candidate)) return candidate
    }
  }
  return null
}

function windowsExtensions(name: string, env: NodeJS.ProcessEnv): string[] {
  const configured = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  return configured.some((extension) => name.toUpperCase().endsWith(extension.toUpperCase())) ? [''] : configured
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isInsideGitWorktree(path: string): boolean {
  try {
    const out = execFileSync('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8', timeout: 5_000 })
    return out.trim() === 'true'
  } catch {
    return false
  }
}

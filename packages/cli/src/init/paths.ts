import { access, mkdir, stat } from 'node:fs/promises'
import { constants, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { inspectFactoryDatabase } from '@ductum/core'

import type { RunProcess } from '../runtime.js'
import { DEFAULT_FACTORY_NAME, factoriesRoot } from '../serve/factory-discovery.js'
import { InitCommandError } from './errors.js'

export const DEFAULT_INSTALL_DIR = '~/.ductum/factories'
export const DEFAULT_PROJECT_NAME = DEFAULT_FACTORY_NAME

export interface InitPaths {
  installDir: string
  projectName: string
  projectDir: string
}

export interface InitTargetValidation {
  projectDir: string
}

export function resolveInitPaths(input: {
  dir: string
  projectName: string
  cwd?: string
  env?: Record<string, string | undefined>
}): InitPaths {
  const installDir = expandPath(input.dir, input.cwd, input.env)
  return {
    installDir,
    projectName: input.projectName,
    projectDir: join(installDir, input.projectName),
  }
}

export function expandPath(
  value: string,
  cwd = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string {
  const trimmed = value.trim()
  const home = env.HOME ?? homedir()
  const expanded = trimmed === '~' ? home : trimmed.startsWith('~/') ? join(home, trimmed.slice(2)) : trimmed
  return resolve(isAbsolute(expanded) ? expanded : join(cwd, expanded))
}

export function validateProjectName(name: string): string {
  const trimmed = name.trim()
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(trimmed)) {
    throw new InitCommandError({
      code: 'init_invalid_project_name',
      message: 'Project name must be a slug: lowercase letters, numbers, and hyphens only.',
      recoverable: true,
      suggestedActions: [{ kind: 'edit_project_name', description: 'Use a slug such as factory or my-factory.' }],
      context: { projectName: name },
    })
  }
  return trimmed
}

export async function validateInitTarget(
  projectDir: string,
  runProcess: RunProcess,
  signal?: AbortSignal,
): Promise<InitTargetValidation> {
  await validateWritableDirectory(projectDir, runProcess, signal)
  return { projectDir }
}

export function assertInitTargetValidation(validation: InitTargetValidation, projectDir: string): void {
  if (validation.projectDir !== projectDir) {
    throw new Error(`validated init target mismatch: ${validation.projectDir} !== ${projectDir}`)
  }
}

export async function validateWritableDirectory(path: string, runProcess: RunProcess, signal?: AbortSignal): Promise<void> {
  const dbState = inspectFactoryDatabase(join(path, 'ductum.db')).state
  if (dbState === 'has_factory') throw alreadyInitialized(path, 'database')
  if (existsSync(join(path, 'ductum.yaml'))) throw alreadyInitialized(path, 'legacy-config')
  const checkPath = existsSync(path) ? path : existingParent(path)
  try {
    const info = await stat(checkPath)
    if (!info.isDirectory()) throw new Error(`${checkPath} is not a directory`)
    await access(checkPath, constants.W_OK)
  } catch (error) {
    throw new InitCommandError({
      code: 'init_path_unwritable',
      message: `Cannot write to ${path}.`,
      recoverable: true,
      suggestedActions: [{ kind: 'choose_directory', description: 'Choose a writable directory.' }],
      context: { path, cause: error instanceof Error ? error.message : String(error) },
    })
  }
  await assertNoUncommittedGitChanges(path, runProcess, signal)
}

export function defaultInitInstallDir(env: Record<string, string | undefined> = process.env): string {
  return factoriesRoot(env)
}

export function defaultInitProjectDir(env: Record<string, string | undefined> = process.env): string {
  return join(defaultInitInstallDir(env), DEFAULT_PROJECT_NAME)
}

export async function ensureWritableParent(path: string): Promise<void> {
  await mkdir(existingParent(path), { recursive: true })
  await access(existingParent(path), constants.W_OK)
}

export function alreadyInitialized(path: string, source: 'database' | 'legacy-config' = 'database'): InitCommandError {
  return new InitCommandError({
    code: 'init_already_initialized',
    message: source === 'database'
      ? `${path} already contains DB-backed Ductum Factory state.`
      : `${path} already contains legacy ductum.yaml state.`,
    recoverable: true,
    suggestedActions: [{
      kind: 'start_existing_factory',
      description: 'Start the existing factory instead.',
      cmd: `ductum start --dir ${path}`,
      args: { dir: path },
    }],
    context: { path, source },
  })
}

async function assertNoUncommittedGitChanges(path: string, runProcess: RunProcess, signal?: AbortSignal): Promise<void> {
  if (!existsSync(path)) return
  const options = signal == null ? undefined : { signal }
  const inside = await runProcess('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], options)
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return
  const status = await runProcess('git', ['-C', path, 'status', '--porcelain'], options)
  if (status.code === 0 && status.stdout.trim() === '') return
  throw new InitCommandError({
    code: 'init_git_uncommitted',
    message: `${path} is inside a git repo with uncommitted changes.`,
    recoverable: true,
    suggestedActions: [{ kind: 'commit_or_choose_directory', description: 'Commit the changes or choose another directory.' }],
    context: { path, status: status.stdout },
  })
}

function existingParent(path: string): string {
  let current = resolve(path)
  while (!existsSync(current)) {
    const next = resolve(current, '..')
    if (next === current) return current
    current = next
  }
  return current
}

import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { inspectFactoryDatabase, type FactoryDatabaseInspection } from '@ductum/core'

import { expandPath } from '../init/paths.js'

export type ServeCommandName = 'start'

export interface StartupBoundary {
  command: ServeCommandName
  factoryDir: string
  dbPath: string
  database: FactoryDatabaseInspection
}

export function defaultFactoryDataDir(env: Record<string, string | undefined> = process.env): string {
  return resolve(defaultDuctumHome(env), 'factories', 'default')
}

export function resolveFactoryDir(input: {
  command: ServeCommandName
  dir?: string
  cwd?: string
  env?: Record<string, string | undefined>
}): string {
  if (input.dir != null) return expandPath(input.dir, input.cwd, input.env)
  const defaultDir = defaultFactoryDataDir(input.env)
  if (hasFactoryState(defaultDir)) return defaultDir
  const discovered = discoverNestedFactoryDirs(input.env)
  if (discovered.length === 1) return discovered[0]!
  if (discovered.length > 1) {
    throw new Error([
      'Multiple Ductum factories found. Use --dir to choose one:',
      ...discovered.map((dir) => `  ${dir}`),
    ].join('\n'))
  }
  return defaultDir
}

export function resolveStartupBoundary(input: {
  command: ServeCommandName
  factoryDir: string
  dbPath: string
}): StartupBoundary {
  assertInsideFactoryDir(input.factoryDir, input.dbPath, '--db')
  const database = inspectFactoryDatabase(input.dbPath)
  if (database.state !== 'has_factory') {
    throw missingFactory(input, database)
  }
  return { ...input, database }
}

function defaultDuctumHome(env: Record<string, string | undefined>): string {
  return resolve(env.DUCTUM_HOME?.trim() || resolve(env.HOME?.trim() || homedir(), '.ductum'))
}

function assertInsideFactoryDir(factoryDir: string, targetPath: string, option: '--db'): void {
  const root = resolve(factoryDir)
  const target = resolve(targetPath)
  const rel = relative(root, target)
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`))) return
  throw new Error(`${option} must stay inside the Factory data directory (--dir): ${target}`)
}

function missingFactory(
  input: { command: ServeCommandName; factoryDir: string; dbPath: string },
  database: FactoryDatabaseInspection,
): Error {
  const reason = database.state === 'no_schema'
    ? `${input.dbPath} is not a Ductum Factory database`
    : `${input.dbPath} has no Factory record`
  const parent = dirname(input.factoryDir)
  return new Error([
    `No Factory setup found for ductum ${input.command}: ${reason}.`,
    `Next setup action: ductum init --dir ${parent} --name ${basename(input.factoryDir)}`,
  ].join(' '))
}

function discoverNestedFactoryDirs(env: Record<string, string | undefined> = process.env): string[] {
  const root = resolve(defaultDuctumHome(env), 'factories')
  if (!isDirectory(root)) return []
  const dirs: string[] = []
  for (const entry of safeReaddir(root)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const candidate = resolve(root, entry.name, 'ductum')
    if (hasFactoryState(candidate)) dirs.push(candidate)
  }
  return dirs.sort((a, b) => a.localeCompare(b))
}

function hasFactoryState(dir: string): boolean {
  return isDirectory(dir) && inspectFactoryDatabase(join(dir, 'ductum.db')).state === 'has_factory'
}

function safeReaddir(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function basename(path: string): string {
  const parts = resolve(path).split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? 'factory'
}

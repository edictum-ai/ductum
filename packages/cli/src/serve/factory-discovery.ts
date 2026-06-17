import { readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { inspectFactoryDatabase } from '@ductum/core'

export interface DiscoveredFactoryDataDir {
  name: string
  dir: string
}

export function defaultDuctumHome(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.DUCTUM_HOME?.trim() || join(env.HOME?.trim() || homedir(), '.ductum'))
}

export function factoriesRoot(env: Record<string, string | undefined> = process.env): string {
  return join(defaultDuctumHome(env), 'factories')
}

export function defaultFactoryDataDir(env: Record<string, string | undefined> = process.env): string {
  return join(factoriesRoot(env), 'default')
}

export function resolveImplicitFactoryDataDir(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.DUCTUM_FACTORY_DATA_DIR?.trim()
  if (configured != null && configured !== '') return expandPath(configured, env)
  const defaultDir = defaultFactoryDataDir(env)
  if (hasFactoryState(defaultDir)) return defaultDir
  const discovered = discoverFactoryDataDirs(env)
  return discovered.length === 1 ? discovered[0]!.dir : null
}

export function discoverFactoryDataDirs(
  env: Record<string, string | undefined> = process.env,
): DiscoveredFactoryDataDir[] {
  const root = factoriesRoot(env)
  if (!isDirectory(root)) return []
  const found = new Map<string, DiscoveredFactoryDataDir>()
  for (const entry of safeReaddir(root).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const direct = join(root, entry.name)
    addFactoryDir(found, entry.name, direct)
    addFactoryDir(found, entry.name, join(direct, 'ductum'))
  }
  return [...found.values()]
}

export function hasFactoryState(dir: string): boolean {
  return isDirectory(dir) && inspectFactoryDatabase(join(dir, 'ductum.db')).state === 'has_factory'
}

function addFactoryDir(
  found: Map<string, DiscoveredFactoryDataDir>,
  name: string,
  dir: string,
): void {
  if (!hasFactoryState(dir)) return
  found.set(resolve(dir), { name, dir: resolve(dir) })
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

function expandPath(value: string, env: Record<string, string | undefined>): string {
  const home = env.HOME?.trim() || homedir()
  const expanded = value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value
  return resolve(expanded)
}

import { existsSync, type Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Worktree inventory for the operator ops-health surface.
 *
 * Walks the configured worktree base path the same way
 * `WorktreeManager.cleanupStale` does — `<basePath>/<project>/<taskSlug>`
 * where `taskSlug` ends in a 6-char short id — but only reads sizes and
 * metadata. It never deletes anything; cleanup must go through the
 * guarded `/api/factory/ops-health/cleanup-worktrees` route which reuses
 * the dispatcher's protected-short-id set.
 */

export interface OpsWorktreeEntry {
  /** Absolute path to the task directory (the unit that cleanup removes). */
  path: string
  /** Top-level project directory name under basePath. */
  project: string
  /** Task directory name (`<sanitizedTaskName>-<shortId>`). */
  taskDir: string
  /** Trailing short id embedded in the directory name, if parseable. */
  shortId: string | null
  /** True if the path exists when probed. False if it disappeared mid-scan. */
  exists: boolean
  /**
   * True if the directory was readable for size + mtime. False on permission
   * errors or other I/O failures so the UI can mark it as inaccessible
   * instead of silently dropping the row.
   */
  accessible: boolean
  /** Recursive directory size in bytes, or null when inaccessible/missing. */
  bytes: number | null
  /** Directory mtime in epoch ms, or null when inaccessible/missing. */
  mtimeMs: number | null
}

export interface OpsWorktreeInventory {
  /** True when worktree isolation is enabled in the runtime config. */
  enabled: boolean
  /** Absolute base path the dispatcher creates worktrees under. */
  basePath: string | null
  /** Sum of accessible entry bytes. Null when no entries were measurable. */
  totalBytes: number | null
  /** True when at least one entry was measurable. False hides "0 B" lies. */
  measurable: boolean
  /** Count of discovered task directories plus unreadable project directories. */
  directoryCount: number
  entries: OpsWorktreeEntry[]
  /** Non-fatal collection error message, surfaced verbatim to the operator. */
  error: string | null
}

const INVENTORY_CACHE_TTL_MS = 30_000
let inventoryCache: {
  key: string
  expiresAt: number
  value: OpsWorktreeInventory
} | null = null

export function clearWorktreeInventoryCache(): void {
  inventoryCache = null
}

/** inventory returned when worktrees are disabled or no base path is configured. */
export function unavailableWorktreeInventory(
  enabled: boolean,
  basePath: string | null,
  reason: string,
): OpsWorktreeInventory {
  return {
    enabled,
    basePath,
    totalBytes: null,
    measurable: false,
    directoryCount: 0,
    entries: [],
    error: reason,
  }
}

const SHORT_ID_SUFFIX = /-([A-Za-z0-9_-]{6})$/

export async function collectWorktreeInventory(
  basePath: string | null,
  enabled: boolean,
): Promise<OpsWorktreeInventory> {
  const cacheKey = `${enabled ? 'enabled' : 'disabled'}:${basePath ?? ''}`
  const cached = inventoryCache
  const now = Date.now()
  if (cached != null && cached.key === cacheKey && cached.expiresAt > now) return cached.value
  if (!enabled) {
    return cacheInventory(cacheKey, unavailableWorktreeInventory(false, basePath, 'Worktree isolation is disabled in Factory Runtime Settings.'))
  }
  if (basePath == null || basePath.trim() === '') {
    return cacheInventory(cacheKey, unavailableWorktreeInventory(true, null, 'No worktree base path is configured.'))
  }
  const absBase = resolve(basePath)
  if (!existsSync(absBase)) {
    return cacheInventory(cacheKey, unavailableWorktreeInventory(true, absBase, `Worktree base path does not exist: ${absBase}`))
  }

  try {
    const projectEntries = await readdir(absBase, { withFileTypes: true })
    const entries: OpsWorktreeEntry[] = []
    const errors: string[] = []
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory()) continue
      const projectPath = join(absBase, projectEntry.name)
      let taskEntries: Dirent[]
      try {
        taskEntries = await readdir(projectPath, { withFileTypes: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        entries.push(await inaccessibleProjectEntry(projectPath, projectEntry.name))
        errors.push(`Worktree project directory unreadable: ${projectPath} (${message})`)
        continue
      }
      for (const taskEntry of taskEntries) {
        if (!taskEntry.isDirectory()) continue
        const taskDir = taskEntry.name
        const dirPath = join(projectPath, taskDir)
        entries.push(await measureEntry(dirPath, projectEntry.name, taskDir))
      }
    }
    const measurable = entries.some((entry) => entry.bytes != null)
    const totalBytes = entries.reduce<number>((sum, entry) => (entry.bytes == null ? sum : sum + entry.bytes), 0)
    return cacheInventory(cacheKey, {
      enabled: true,
      basePath: absBase,
      totalBytes: measurable ? totalBytes : null,
      measurable,
      directoryCount: entries.length,
      entries: entries.sort(compareEntry),
      error: errors.at(0) ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return cacheInventory(cacheKey, unavailableWorktreeInventory(true, absBase, `Worktree inventory collection failed: ${message}`))
  }
}

async function inaccessibleProjectEntry(path: string, project: string): Promise<OpsWorktreeEntry> {
  let mtimeMs: number | null = null
  try {
    mtimeMs = (await stat(path)).mtimeMs
  } catch {
    mtimeMs = null
  }
  return {
    path,
    project,
    taskDir: '(project directory unreadable)',
    shortId: null,
    exists: true,
    accessible: false,
    bytes: null,
    mtimeMs,
  }
}

async function measureEntry(
  path: string,
  project: string,
  taskDir: string,
): Promise<OpsWorktreeEntry> {
  const shortIdMatch = taskDir.match(SHORT_ID_SUFFIX)
  const shortId = shortIdMatch?.[1] ?? null
  if (!existsSync(path)) {
    return { path, project, taskDir, shortId, exists: false, accessible: false, bytes: null, mtimeMs: null }
  }
  try {
    const stats = await stat(path)
    const { bytes, complete } = await directorySize(path)
    if (!complete) {
      return { path, project, taskDir, shortId, exists: true, accessible: false, bytes: null, mtimeMs: stats.mtimeMs }
    }
    return { path, project, taskDir, shortId, exists: true, accessible: true, bytes, mtimeMs: stats.mtimeMs }
  } catch {
    // Ignore the underlying filesystem error string; the dashboard renders
    // inaccessible paths with a fixed badge so the operator knows to fix
    // permissions without us surfacing a noisy filesystem message.
    return {
      path,
      project,
      taskDir,
      shortId,
      exists: true,
      accessible: false,
      bytes: null,
      mtimeMs: null,
    }
  }
}

async function directorySize(path: string): Promise<{ bytes: number; complete: boolean }> {
  let total = 0
  let complete = true
  const stack: string[] = [path]
  while (stack.length > 0) {
    const current = stack.pop()!
    let entries: Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (current === path) throw error
      complete = false
      continue
    }
    for (const entry of entries) {
      const childPath = join(current, entry.name)
      try {
        if (entry.isDirectory()) {
          stack.push(childPath)
        } else if (entry.isFile()) {
          const stats = await stat(childPath)
          total += stats.size
        }
      } catch {
        complete = false
      }
    }
  }
  return { bytes: total, complete }
}

function compareEntry(a: OpsWorktreeEntry, b: OpsWorktreeEntry): number {
  if (a.project !== b.project) return a.project.localeCompare(b.project)
  return a.taskDir.localeCompare(b.taskDir)
}

function cacheInventory(key: string, value: OpsWorktreeInventory): OpsWorktreeInventory {
  inventoryCache = { key, value, expiresAt: Date.now() + INVENTORY_CACHE_TTL_MS }
  return value
}

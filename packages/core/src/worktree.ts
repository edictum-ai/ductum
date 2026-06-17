/**
 * Git worktree manager for agent isolation.
 *
 * Each dispatched run gets its own worktree so agents can work
 * on the same repo in parallel without conflicts.
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { log } from './logger.js'

const execFileAsync = promisify(execFile)
const DEFAULT_BASE_PATH = '.ductum/worktrees'
const DEFAULT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

export interface WorktreeConfig {
  enabled: boolean
  basePath: string
  cleanupOnSuccess: boolean
  cleanupOnFailure: boolean
  /** Max age in ms before a worktree is considered stale and eligible for cleanup. */
  staleThresholdMs: number
}

export const DEFAULT_WORKTREE_CONFIG: WorktreeConfig = {
  enabled: true,
  basePath: DEFAULT_BASE_PATH,
  cleanupOnSuccess: true,
  cleanupOnFailure: true,
  staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
}

export class WorktreeSetupError extends Error {
  constructor(
    readonly command: string,
    readonly worktreePath: string,
    causeMessage: string,
  ) {
    super(`setup command failed: ${command} (in ${worktreePath}) — ${causeMessage}`)
    this.name = 'WorktreeSetupError'
  }
}

function sanitizeForGitRef(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50)
}

export class WorktreeManager {
  private readonly config: WorktreeConfig

  constructor(config: Partial<WorktreeConfig> = {}) {
    this.config = { ...DEFAULT_WORKTREE_CONFIG, ...config }
  }

  get enabled(): boolean {
    return this.config.enabled
  }

  get cleanupOnSuccess(): boolean {
    return this.config.cleanupOnSuccess
  }

  get cleanupOnFailure(): boolean {
    return this.config.cleanupOnFailure
  }

  /**
   * Create a git worktree for a run.
   * Returns the worktree path, or the original repoPath if not a git repo.
   *
   * Directory structure: {basePath}/{projectName}/{taskName}-{shortId}/{repoName}
   * Example: .ductum/worktrees/ductum/P1-TRIAGE-HOMEPAGE-qVy6qB/ductum
   */
  async create(repoPath: string, taskName: string, runId: string, projectName?: string, setupCommands?: string[]): Promise<string> {
    if (!this.config.enabled) return repoPath
    if (!this.isGitRepo(repoPath)) {
      log.warn('worktree', `${repoPath} is not a git repo — skipping worktree`)
      return repoPath
    }

    const repoName = basename(repoPath)
    const sanitized = sanitizeForGitRef(taskName)
    const shortId = runId.slice(0, 6)
    const branch = `ductum/${sanitized}-${shortId}`
    const projectDir = projectName != null ? sanitizeForGitRef(projectName) : runId
    const taskSlug = `${sanitized}-${shortId}`
    // Resolve to absolute — git worktree add requires absolute paths
    const absBase = resolve(this.config.basePath)
    const worktreePath = join(absBase, projectDir, taskSlug, repoName)

    // Ensure parent directory exists
    await mkdir(join(absBase, projectDir, taskSlug), { recursive: true })

    // Remove existing worktree at this path (stale from previous run)
    if (existsSync(worktreePath)) {
      await this.forceRemove(repoPath, worktreePath)
    }

    try {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, '-B', branch], {
        encoding: 'utf-8',
        timeout: 30_000,
      })
      log.info('worktree', `created ${worktreePath} (branch: ${branch})`)

      await this.runSetupCommands(worktreePath, setupCommands)

      return worktreePath
    } catch (error) {
      if (error instanceof WorktreeSetupError) throw error
      const msg = error instanceof Error ? error.message : String(error)
      log.error('worktree', `failed to create worktree at ${worktreePath}: ${msg}`)
      return repoPath
    }
  }

  async restore(repoPath: string, worktreePath: string, ref: string, setupCommands?: string[]): Promise<string> {
    if (!this.config.enabled) return worktreePath
    if (existsSync(worktreePath)) return worktreePath
    if (!this.isGitRepo(repoPath)) throw new Error(`cannot restore missing worktree; source is not a git repo: ${repoPath}`)

    await mkdir(dirname(worktreePath), { recursive: true })
    await execFileAsync('git', ['-C', repoPath, 'worktree', 'prune'], {
      encoding: 'utf-8',
      timeout: 10_000,
    })
    await execFileAsync('git', ['-C', repoPath, 'worktree', 'add', worktreePath, ref], {
      encoding: 'utf-8',
      timeout: 30_000,
    })
    log.info('worktree', `restored ${worktreePath} from ${ref}`)
    await this.runSetupCommands(worktreePath, setupCommands)
    return worktreePath
  }

  /**
   * Remove a worktree and its directory.
   */
  async remove(worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) return

    // Find the parent repo by checking git worktree list from the worktree itself
    try {
      const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'rev-parse', '--git-common-dir'], {
        encoding: 'utf-8',
        timeout: 5_000,
      })
      const gitCommonDir = stdout.trim()
      // The common dir is the .git dir of the main repo
      const mainRepoPath = join(gitCommonDir, '..')

      await execFileAsync('git', ['-C', mainRepoPath, 'worktree', 'remove', worktreePath, '--force'], {
        encoding: 'utf-8',
        timeout: 10_000,
      })
      log.info('worktree', `removed ${worktreePath}`)
    } catch {
      // Fallback: just delete the directory
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
      log.warn('worktree', `force-deleted ${worktreePath} (git worktree remove failed)`)
    }
  }

  /**
   * Check if a path is inside a git repository.
   */
  isGitRepo(path: string): boolean {
    try {
      return existsSync(join(path, '.git'))
    } catch {
      return false
    }
  }

  /**
   * Remove worktree directories that no longer belong to an active run.
   *
   * @param activeShortIds - Short run ids (first 6 chars) that ARE still
   *   live and must be preserved. Any task dir whose short id suffix is
   *   not in this set is eligible for removal.
   * @param options.force - When true, ignore the staleThresholdMs age
   *   check and remove any dir whose run isn't active. Used on startup
   *   so we don't accumulate crashed runs across server restarts.
   * @returns Number of stale worktree directories removed.
   */
  async cleanupStale(
    activeShortIds?: ReadonlySet<string>,
    options: { force?: boolean } = {},
  ): Promise<number> {
    const absBase = resolve(this.config.basePath)
    if (!this.config.enabled || !existsSync(absBase)) return 0

    const now = Date.now()
    let removed = 0
    const force = options.force === true

    try {
      const projectEntries = await readdir(absBase, { withFileTypes: true })
      for (const projectEntry of projectEntries) {
        if (!projectEntry.isDirectory()) continue
        const projectPath = join(absBase, projectEntry.name)
        const taskEntries = await readdir(projectPath, { withFileTypes: true }).catch(() => [])
        for (const entry of taskEntries) {
          if (!entry.isDirectory()) continue

          const dirPath = join(projectPath, entry.name)
          // Task dirs look like `<sanitizedTaskName>-<shortId>` where
          // shortId is the 6-char prefix of the run id. Extract it so
          // we can correlate against the active-run set.
          const shortIdMatch = entry.name.match(/-([A-Za-z0-9_-]{6})$/)
          const shortId = shortIdMatch?.[1]

          // Preserve active runs regardless of force mode.
          if (shortId != null && activeShortIds?.has(shortId)) continue

          try {
            const stats = await stat(dirPath)
            const age = now - stats.mtimeMs
            const isStaleByAge = age > this.config.staleThresholdMs
            // In force mode (startup, manual cleanup), remove any
            // inactive dir. Otherwise require age threshold.
            if (force || isStaleByAge) {
              await rm(dirPath, { recursive: true, force: true })
              removed++
              log.info(
                'worktree',
                `cleaned up worktree: ${dirPath}${force ? ' (forced)' : ` (age: ${Math.round(age / 3600_000)}h)`}`,
              )
            }
          } catch {
            // Directory may have been removed concurrently — ignore
          }
        }
        // Remove empty project dirs
        const remaining = await readdir(projectPath).catch(() => ['nonempty'])
        if (remaining.length === 0) {
          await rm(projectPath, { recursive: true, force: true }).catch(() => undefined)
        }
      }
    } catch (error) {
      log.warn('worktree', `stale worktree cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    return removed
  }

  private async forceRemove(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await execFileAsync('git', ['-C', repoPath, 'worktree', 'remove', worktreePath, '--force'], {
        encoding: 'utf-8',
        timeout: 10_000,
      })
    } catch {
      await rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async runSetupCommands(worktreePath: string, setupCommands?: string[]): Promise<void> {
    for (const cmd of setupCommands ?? []) {
      try {
        log.info('worktree', `setup: ${cmd} (in ${worktreePath})`)
        await execFileAsync('/bin/sh', ['-c', cmd], { cwd: worktreePath, encoding: 'utf-8', timeout: 120_000 })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.error('worktree', `setup command failed: ${cmd} — ${msg}`)
        throw new WorktreeSetupError(cmd, worktreePath, msg)
      }
    }
  }
}

import { existsSync } from 'node:fs'

import type { Run } from './types.js'
import type { WorktreeManager } from './worktree.js'

export async function resolveInheritedWorktree(input: {
  baseWorkingDir: string | undefined
  inheritedWorktreePath: string
  reuseRun: Run | null
  setupCommands: string[] | undefined
  worktreeManager: WorktreeManager | undefined
}): Promise<string> {
  if (existsSync(input.inheritedWorktreePath)) return input.inheritedWorktreePath
  if (input.worktreeManager?.enabled !== true) return input.inheritedWorktreePath

  const ref = input.reuseRun?.branch ?? input.reuseRun?.commitSha
  if (input.baseWorkingDir != null && ref != null) {
    const restored = await input.worktreeManager.restore(
      input.baseWorkingDir,
      input.inheritedWorktreePath,
      ref,
      input.setupCommands,
    )
    if (existsSync(restored)) return restored
    throw new Error(`Inherited worktree restore did not recreate ${restored}`)
  }

  const source = input.reuseRun == null ? 'unknown source run' : `source run ${input.reuseRun.id}`
  throw new Error(`Inherited worktree is missing for ${source}: ${input.inheritedWorktreePath}`)
}

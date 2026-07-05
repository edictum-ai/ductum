import { existsSync } from 'node:fs'

import { blockTaskForPrerequisites } from './dispatcher-prerequisite-block.js'
import { PrerequisiteCheckError } from './repair-dispatch.js'
import type { PrerequisiteIssue } from './repair-types.js'
import type { TaskRepo } from './repos/interfaces.js'
import type { TaskDispatchSkipRepo } from './repos/task-dispatch-skip.js'
import type { Run, Task } from './types.js'
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

  throw new Error(missingInheritedWorktreeMessage(input.inheritedWorktreePath, input.reuseRun))
}

/**
 * Synchronous preflight for legacy (non-sandbox) inherited worktree dispatch.
 * Throws when the preserved path is gone and no restorable branch or commit
 * reference can recreate it. Mirror {@link resolveInheritedWorktree}'s missing
 * path message so callers see one consistent failure shape across preflight
 * and spawn-time resolution.
 */
export function assertInheritedWorktreeAvailable(input: {
  baseWorkingDir: string | undefined
  inheritedWorktreePath: string
  reuseRun: Run | null
  worktreeManager: WorktreeManager | undefined
}): void {
  if (existsSync(input.inheritedWorktreePath)) return
  if (input.worktreeManager?.enabled === true) {
    const ref = input.reuseRun?.branch ?? input.reuseRun?.commitSha
    if (input.baseWorkingDir != null && ref != null) return
  }
  throw new Error(missingInheritedWorktreeMessage(input.inheritedWorktreePath, input.reuseRun))
}

/**
 * Pre-run-creation gate for legacy (non-sandbox) dispatch that reuses a
 * preserved worktree from another run. When the inherited path is missing
 * with no restorable ref, mark the task blocked, record a prerequisite
 * dispatch skip, and throw an {@link InheritedWorktreeMissingError} -- never
 * create a child run, mark the task active, or spawn an orphan harness
 * attempt. Sandbox runtime dispatch keeps its own preflight in
 * {@link assertSupportedSandboxRuntime}; this helper is a no-op for sandbox
 * profiles, for runs without an inherited worktree, and for live (non-
 * terminal) source runs whose worktree path is still owned by an active
 * session. The atomicity contract targets retry/review/fix dispatch into a
 * preserved worktree whose source run has already reached a terminal state.
 */
export function ensureInheritedWorktreeDispatch(input: {
  taskRepo: TaskRepo
  taskDispatchSkipRepo: TaskDispatchSkipRepo | undefined
  task: Task
  hasSandboxProfile: boolean
  baseWorkingDir: string | undefined
  inheritedWorktreePaths: string[] | null
  reuseRun: Run | null
  worktreeManager: WorktreeManager | undefined
  now: Date
}): void {
  if (input.hasSandboxProfile) return
  if (input.inheritedWorktreePaths == null || input.inheritedWorktreePaths.length === 0) return
  // Live source runs still own their worktree; only enforce the atomicity
  // contract when the source run has reached a terminal state (preserved).
  if (input.reuseRun == null || input.reuseRun.terminalState == null) return
  try {
    assertInheritedWorktreeAvailable({
      baseWorkingDir: input.baseWorkingDir,
      inheritedWorktreePath: input.inheritedWorktreePaths[0]!,
      reuseRun: input.reuseRun,
      worktreeManager: input.worktreeManager,
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    blockTaskForPrerequisites(input.taskRepo, input.taskDispatchSkipRepo, {
      taskId: input.task.id,
      detail,
      blockedAt: input.now.toISOString(),
    })
    throw new InheritedWorktreeMissingError(detail)
  }
}

/**
 * Subclass of {@link PrerequisiteCheckError} so the dispatcher cycle
 * preserves the dispatch skip recorded for the blocked task (the cycle
 * only clears skips for non-prerequisite failures). Carries the missing-
 * path detail so logs and tests can match on the exact failure shape.
 */
export class InheritedWorktreeMissingError extends PrerequisiteCheckError {
  constructor(readonly inheritedWorktreeDetail: string) {
    super([inheritedWorktreeIssue(inheritedWorktreeDetail)])
  }
}

function inheritedWorktreeIssue(detail: string): PrerequisiteIssue {
  return {
    id: 'inherited-worktree-missing',
    area: 'dispatcher_visibility',
    severity: 'blocker',
    title: 'Inherited worktree is missing',
    reason: detail,
    suggestedAction: 'Restore the source run branch/commit or clear the orphan worktree reference, then re-enable the task.',
    record: { type: 'Task', id: null, name: null },
    field: { path: 'task.inheritedWorktree', label: 'Inherited worktree', value: detail },
    blocks: 'Blocks dispatch until the worktree can be restored or the reference is cleared.',
    status: 'missing',
    issueCode: 'inherited_worktree_missing',
    target: null,
    href: null,
    linkLabel: null,
  }
}

function missingInheritedWorktreeMessage(inheritedWorktreePath: string, reuseRun: Run | null): string {
  const source = reuseRun == null ? 'unknown source run' : `source run ${reuseRun.id}`
  return `Inherited worktree is missing for ${source}: ${inheritedWorktreePath}`
}

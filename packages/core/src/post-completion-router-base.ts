import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { AgentRuntimeResolutionError } from './agent-runtime-resolution.js'
import { autoCommitWorktree } from './auto-commit.js'
import { isBakeoffBlindReviewTask } from './bakeoff.js'
import { toErrorMessage } from './dispatcher-support.js'
import { validateEvidencePayload } from './evidence-kinds.js'
import { syncRunGitArtifacts } from './git-artifacts.js'
import { log } from './logger.js'
import { buildWorktreeSnapshotEvidence } from './post-completion-snapshot.js'
import type { VerifyResult } from './post-completion.js'
import type { RouterContext } from './post-completion-router-types.js'
import { createId, type Run, type RunId, type Task } from './types.js'
import type { WorktreeSnapshotEvidence } from './evidence-kinds.js'
import { readTrackedWorktreeChanges, summarizeTrackedWorktreeChanges } from './worktree-dirty.js'

export class PostCompletionRouterBase {
  constructor(protected readonly ctx: RouterContext) {}

  isBakeoffBlindReviewTask(task: Task): boolean {
    return isBakeoffBlindReviewTask(this.ctx.specRepo.get(task.specId), task)
  }

  protected compareRunRecency(
    left: { run: Run; order: number },
    right: { run: Run; order: number },
  ): number {
    const created = left.run.createdAt.localeCompare(right.run.createdAt)
    if (created !== 0) return created

    const updated = left.run.updatedAt.localeCompare(right.run.updatedAt)
    if (updated !== 0) return updated

    return left.order - right.order
  }

  protected resolveVerifyCommands(projectName: string | null | undefined, run: Run, tag: string): string[] {
    if (projectName == null) return []
    try {
      return this.ctx.postCompletion?.resolveVerifyCommands?.(projectName, run.runtimeWorkflowProfile ?? undefined) ?? []
    } catch (error) {
      if (error instanceof AgentRuntimeResolutionError) throw error
      if (run.runtimeWorkflowProfile != null) {
        throw new AgentRuntimeResolutionError(
          `${tag} WorkflowProfile ${run.runtimeWorkflowProfile.name} (${run.runtimeWorkflowProfile.path}) could not resolve verify commands: ${toErrorMessage(error)}`,
          'resource_malformed',
        )
      }
      throw error
    }
  }

  protected async finalizeDirtyWorktree(
    runId: RunId,
    worktreePath: string,
    taskName: string,
    tag: string,
  ): Promise<boolean> {
    const result = await autoCommitWorktree(worktreePath, taskName)
    if (result.error != null) {
      log.warn('pipeline', `${tag} auto-commit failed: ${result.error}`)
      return !await this.failIfDirtyTrackedWorktree(
        runId,
        worktreePath,
        tag,
        `auto-commit failed before approval snapshot: ${result.error}`,
      )
    }
    if (result.committed) {
      log.info(
        'pipeline',
        `${tag} auto-committed dirty worktree as ${result.sha?.slice(0, 8) ?? '??'} (agent left files uncommitted)`,
      )
    }
    return !await this.failIfDirtyTrackedWorktree(runId, worktreePath, tag)
  }

  protected shouldSyncGitArtifacts(worktreePath: string | null | undefined): worktreePath is string {
    return worktreePath != null && existsSync(worktreePath)
  }

  protected shouldRecordWorktreeSnapshot(worktreePath: string | null | undefined): worktreePath is string {
    return this.shouldSyncGitArtifacts(worktreePath) && existsSync(join(worktreePath, '.git'))
  }

  protected async syncGitArtifacts(runId: RunId, worktreePath: string, tag: string): Promise<void> {
    const run = await syncRunGitArtifacts(this.ctx.runRepo, runId, worktreePath)
    if (run == null) return
    const commit = run.commitSha?.slice(0, 8) ?? 'no-commit'
    log.info('pipeline', `${tag} linked git artifacts for ${runId.slice(0, 6)}: ${run.branch ?? 'no-branch'} @ ${commit}`)
  }

  protected async failIfDirtyTrackedWorktree(
    runId: RunId,
    worktreePath: string,
    tag: string,
    context?: string,
  ): Promise<boolean> {
    const changes = await readTrackedWorktreeChanges(worktreePath)
    if (changes.error == null && changes.files.length === 0) return false

    const reason = changes.error == null
      ? formatDirtyTrackedReason(summarizeTrackedWorktreeChanges(changes), context)
      : formatCleanlinessCheckReason(changes.error, context)
    this.ctx.stateMachine.markFailed(runId, reason)
    log.warn('pipeline', `${tag} ${reason}`)
    return true
  }

  protected async recordWorktreeSnapshot(
    runId: RunId,
    worktreePath: string,
    verifyCommands: string[],
    verifyResult: VerifyResult | null,
    tag: string,
  ): Promise<WorktreeSnapshotEvidence | null> {
    if (!this.shouldRecordWorktreeSnapshot(worktreePath)) return null
    const run = this.ctx.runRepo.get(runId)
    if (run == null) return null
    const payload = await buildWorktreeSnapshotEvidence({
      run,
      worktreePath,
      baseBranch: this.ctx.postCompletion?.rebaseBase,
      verifyCommands,
      verifyResult,
    })
    if (payload == null) return null
    if (!validateEvidencePayload(payload)) {
      log.warn('pipeline', `${tag} skipped invalid worktree snapshot evidence`)
      return null
    }
    const evidenceRepo = this.ctx.evidenceRepo
    if (evidenceRepo == null) return payload
    evidenceRepo.create({
      id: createId<'EvidenceId'>(),
      runId,
      type: 'custom',
      payload: payload as unknown as Record<string, unknown>,
    })
    return payload
  }

  protected resolveProjectName(task: Task): string | undefined {
    const spec = this.ctx.specRepo.get(task.specId)
    if (spec == null) return undefined
    const project = this.ctx.projectRepo.get(spec.projectId)
    return project?.name
  }
}

function formatDirtyTrackedReason(detail: string, context?: string): string {
  return context == null
    ? `attempt worktree has uncommitted tracked changes: ${detail}`
    : `${context}; uncommitted tracked changes: ${detail}`
}

function formatCleanlinessCheckReason(error: string, context?: string): string {
  return context == null
    ? `attempt worktree cleanliness check failed: ${error}`
    : `${context}; worktree cleanliness check failed: ${error}`
}

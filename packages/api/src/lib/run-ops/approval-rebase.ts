/**
 * Decision 122 (P3.2): one-click approval auto-rebase.
 *
 * When `ductum approve` (or the dashboard approval card) hits the
 * stale-branch gate, the operator picks `--rebase` and the API:
 *
 *   1. validates the run is approval-eligible and has or can recreate a worktree,
 *   2. captures the pre-rebase commit SHA + branch,
 *   3. rebases the worktree onto current `main` (or the configured
 *      merge base) using the existing `rebaseWorktreeOntoBase`
 *      helper from `@ductum/core`,
 *   4. re-runs the workflow profile's verify commands in the
 *      rebased worktree,
 *   5. re-links the new commit (`syncRunGitArtifacts`),
 *   6. re-invokes `mergeApprovedRun` so the same merge path the
 *      direct `approve` uses ships the rebased commit, and
 *   7. records an `approval-rebase` evidence row capturing pre/post
 *      commits, the rebase outcome, and the verify result.
 *
 * If the rebase produces conflicts, the API dispatches a fix-rebase
 * task to the original implementer (mirroring the post-completion
 * router's existing behavior for impl-time rebase conflicts) and
 * returns a structured failure the CLI/dashboard can render.
 */

import {
  buildRebaseFixPrompt,
  classifyTask,
  collectDiff,
  createId,
  rebaseWorktreeOntoBase,
  syncRunGitArtifacts,
  verifyWorktree,
  type AgentId,
  type Run,
  type RunId,
  type Task,
  type VerifyResult,
} from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { ValidationError } from '../errors.js'
import { approveRun, type ApproveRunResult } from './approval.js'
import { prepareApprovalRebaseWorktree } from './approval-rebase-worktree.js'
import { requireRun } from './common.js'
import { addEvidence } from './evidence.js'

export interface ApproveRebaseOptions {
  base?: string
}

export interface ApproveRebaseResult extends ApproveRunResult {
  /** SHA before the rebase ran. */
  preRebaseCommit?: string
  /** SHA after the rebase ran (and verify passed). */
  postRebaseCommit?: string
  /** Whether a rebase was actually needed (false = base already merged). */
  rebaseNeeded?: boolean
  /** Whether verify passed in the rebased worktree. */
  verifyPassed?: boolean
  /** When verify failed, the captured stdout/stderr (truncated). */
  verifyOutput?: string
  /** When the rebase produced conflicts, the dispatched fix-rebase task. */
  fixRebaseTaskId?: string
}

export async function approveRunWithRebase(
  context: ApiContext,
  runId: RunId,
  options: ApproveRebaseOptions = {},
): Promise<ApproveRebaseResult> {
  const run = requireRun(context, runId)
  // Mirror approveRun's guards (approval.ts:28/31). The previous
  // single-condition guard short-circuited on terminal runs and let
  // pre-merge side effects (runUpdate log, rebase on disk, evidence
  // row, syncRunGitArtifacts DB write) run before approveRun finally
  // threw. That polluted the audit trail and could overwrite a
  // terminal run's recorded commit SHA. Two separate checks now block
  // both bad states before any side effects.
  if (run.terminalState != null) {
    throw new ValidationError(
      `Run ${runId} is ${run.terminalState}; cannot approve-rebase a terminal run`,
    )
  }
  if (!run.pendingApproval) {
    throw new ValidationError(
      `Run ${runId} is not in a state that needs approval — nothing to rebase`,
    )
  }
  const base = options.base ?? context.merge.base ?? 'main'
  const { git, worktreePath } = await prepareApprovalRebaseWorktree(context, run)

  const preCommit = run.commitSha ?? null
  const preBranch = run.branch ?? git.detectedBranch ?? null

  context.repos.runUpdates.create(
    runId,
    `operator triggered approve --rebase onto ${base}`,
  )

  const rebase = await rebaseWorktreeOntoBase(worktreePath, base)
  if (!rebase.rebased) {
    // Conflict path: dispatch a fix-rebase task and bail.
    const fixTaskId = dispatchApprovalRebaseFix(context, runId, run, base, rebase.output)
    addEvidence(context, runId, 'custom', {
      kind: 'approval-rebase',
      base,
      preCommit,
      preBranch,
      rebaseNeeded: rebase.needed,
      rebaseConflict: true,
      rebaseOutput: rebase.output.slice(0, 4_000),
      fixRebaseTaskId: fixTaskId,
    })
    return {
      success: false,
      stage: run.stage,
      reason: `rebase onto ${base} produced conflicts; fix-rebase task dispatched (${fixTaskId.slice(0, 8)})`,
      preRebaseCommit: preCommit ?? undefined,
      rebaseNeeded: rebase.needed,
      fixRebaseTaskId: fixTaskId,
    }
  }

  const verify = await runVerify(context, run, worktreePath)
  if (!verify.passed) {
    addEvidence(context, runId, 'custom', {
      kind: 'approval-rebase',
      base,
      preCommit,
      preBranch,
      rebaseNeeded: rebase.needed,
      rebaseConflict: false,
      verifyPassed: false,
      verifyOutput: verify.output.slice(0, 4_000),
    })
    return {
      success: false,
      stage: run.stage,
      reason: `rebase succeeded but verify failed in the rebased worktree; deny + retry, do not approve`,
      preRebaseCommit: preCommit ?? undefined,
      rebaseNeeded: rebase.needed,
      verifyPassed: false,
      verifyOutput: verify.output.slice(0, 4_000),
    }
  }

  const synced = await syncRunGitArtifacts(context.repos.runs, runId, worktreePath)
  const postCommit = synced?.commitSha ?? preCommit ?? null

  addEvidence(context, runId, 'custom', {
    kind: 'approval-rebase',
    base,
    preCommit,
    preBranch,
    postCommit,
    rebaseNeeded: rebase.needed,
    rebaseConflict: false,
    verifyPassed: true,
    verifyCommands: verify.commands,
  })

  const approval = await approveRun(context, runId)

  return {
    ...approval,
    preRebaseCommit: preCommit ?? undefined,
    postRebaseCommit: postCommit ?? undefined,
    rebaseNeeded: rebase.needed,
    verifyPassed: true,
  }
}

interface VerifyOutcome extends VerifyResult {
  commands: string[]
}

async function runVerify(
  context: ApiContext,
  run: Run,
  worktreePath: string,
): Promise<VerifyOutcome> {
  const task = context.repos.tasks.get(run.taskId)
  if (task == null) return { passed: false, output: 'task not found', commands: [] }
  const spec = context.repos.specs.get(task.specId)
  const project = spec == null ? null : context.repos.projects.get(spec.projectId)
  const projectName = project?.name
  const profile = run.runtimeWorkflowProfile ?? undefined
  const commands = projectName != null && context.resolveVerifyCommands != null
    ? context.resolveVerifyCommands(projectName, profile) ?? []
    : []
  if (commands.length === 0) {
    // Without commands, trust the existing verify evidence — operator
    // accepted the risk by invoking --rebase. Mark as passed so the
    // approval can proceed.
    return { passed: true, output: '(no verify commands configured)', commands }
  }
  const result = await verifyWorktree(worktreePath, commands)
  return { ...result, commands }
}

function dispatchApprovalRebaseFix(
  context: ApiContext,
  runId: RunId,
  run: Run,
  base: string,
  rebaseOutput: string,
): string {
  const task = context.repos.tasks.get(run.taskId)
  if (task == null) {
    throw new ValidationError(`Run ${runId} has no parent task; cannot dispatch fix-rebase`)
  }
  const parsed = classifyTask(task)
  const originalName = parsed.kind === 'impl' ? task.name : parsed.originalName
  const tasksInSpec = context.repos.tasks.list(task.specId)
  const originalTask = tasksInSpec.find((t) => t.name === originalName) ?? task
  const fixTaskId = createId<'TaskId'>()
  const round = countExistingFixRounds(tasksInSpec, originalName) + 1
  const prompt = buildRebaseFixPrompt(originalTask, base, rebaseOutput)
  context.repos.tasks.create({
    id: fixTaskId,
    specId: task.specId,
    targetId: originalTask.targetId,
    name: `fix-${originalName}-r${round}`,
    prompt,
    repos: originalTask.repos,
    assignedAgentId: run.agentId as AgentId,
    requiredRole: 'builder',
    complexity: 'simple',
    status: 'ready',
    verification: [],
    retryCount: 0,
    retryAfter: null,
  })
  return fixTaskId
}

function countExistingFixRounds(tasks: Task[], originalName: string): number {
  return tasks.filter((t) => {
    const parsed = classifyTask(t)
    if (parsed.kind !== 'fix') return false
    return parsed.originalName === originalName
  }).length
}

// Re-export for tests that want to see the diff that would be reviewed
// after a successful rebase + verify.
export async function previewRebasedDiff(worktreePath: string, base: string): Promise<string> {
  return collectDiff(worktreePath, base)
}

import { Command } from 'commander'

import { isStaleApprovalFailureReason } from '@ductum/core'

import { formatStatusBadge } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { formatAttemptPhase } from './status-overview.js'

export function registerFactoryOpsCommands(program: Command, deps: CliProgramDeps) {
  program
    .command('approve <attemptId>')
    .option('--rebase', 'On stale-branch failure, rebase, verify, and approve in one step', false)
    .option('--base <branch>', 'Override the merge base for --rebase', undefined)
    .option('--reason <text>', 'Operator reason for approving the Attempt', undefined)
    .description('Approve an Attempt waiting for operator approval')
    .action(createAction(deps, async (ctx, attemptId: string, opts: { rebase?: boolean; base?: string; reason?: string }) => {
      if (opts.rebase === true) {
        const result = await ctx.api.approveRunWithRebase(attemptId, opts.base != null ? { base: opts.base } : {})
        renderRebaseApprovalResult(ctx, attemptId, result)
        if (!result.success) throw new Error(`approve --rebase failed: ${result.reason ?? 'unknown'}`)
        return
      }
      const result = opts.reason != null
        ? await ctx.api.approveRun(attemptId, { reason: opts.reason })
        : await ctx.api.approveRun(attemptId)
      if (result.success) {
        const branch = result.branch ?? '(no branch)'
        const sha = result.commitSha != null ? result.commitSha.slice(0, 8) : '(no commit)'
        const pushed = result.pushed === true ? ' (pushed)' : ''
        ctx.write(result, `Attempt ${attemptId} approved -> merged ${branch} ${sha}${pushed}`)
        return
      }
      const reason = result.reason ?? 'unknown'
      const lines = [
        `Attempt ${attemptId} approval failed: ${reason}`,
        `phase: ${formatAttemptPhase(result.stage)}`,
      ]
      if (result.nextCommand != null) lines.push(`next: ${result.nextCommand}`)
      if (result.followupCommand != null) lines.push(`then: ${result.followupCommand}`)
      if (isStaleApprovalFailureReason(reason)) {
        lines.push(`auto: approve ${attemptId} --rebase  (rebase + re-verify + re-approve in one step)`)
      }
      ctx.write(result, lines.join('\n'))
      throw new Error(`approval failed: ${reason}`)
    }))

  program
    .command('deny <attemptId>')
    .requiredOption('--reason <text>', 'Operator reason for denying approval')
    .description('Deny an Attempt waiting for operator approval and make it retryable')
    .action(createAction(deps, async (ctx, attemptId: string, opts: { reason: string }) => {
      const run = await ctx.api.rejectRun(attemptId, opts.reason)
      const lines = [
        `Attempt ${run.id} rejected`,
        `phase: ${formatAttemptPhase(run.stage)}`,
        `result: ${run.terminalState == null ? '-' : formatAttemptPhase(run.terminalState)}`,
      ]
      if (run.terminalState === 'failed') lines.push(`next: retry ${run.id}`)
      ctx.write(run, lines.join('\n'))
    }))

  program
    .command('retry <attemptId>')
    .option('--reason <text>', 'Operator reason for retrying the Attempt', undefined)
    .description('Repair: make the Task for a failed or stalled Attempt ready again')
    .action(createAction(deps, async (ctx, attemptId: string, opts: { reason?: string }) => {
      const result = opts.reason != null
        ? await ctx.api.retryRun(attemptId, { reason: opts.reason })
        : await ctx.api.retryRun(attemptId)
      ctx.write(result, [
        `Attempt ${attemptId} marked for retry`,
        `task: ${result.taskId}`,
        `taskStatus: ${formatStatusBadge(result.taskStatus)}`,
      ].join('\n'))
    }))
}

interface RebaseApprovalResult {
  success: boolean
  stage: string
  reason?: string
  branch?: string
  commitSha?: string
  pushed?: boolean
  preRebaseCommit?: string
  postRebaseCommit?: string
  rebaseNeeded?: boolean
  verifyPassed?: boolean
  verifyOutput?: string
  fixRebaseTaskId?: string
}

function renderRebaseApprovalResult(
  ctx: { write: (raw: unknown, text: string) => void },
  attemptId: string,
  result: RebaseApprovalResult,
): void {
  const lines: string[] = []
  if (result.success) {
    const branch = result.branch ?? '(no branch)'
    const sha = result.commitSha != null ? result.commitSha.slice(0, 8) : '(no commit)'
    const pushed = result.pushed === true ? ' (pushed)' : ''
    const preSha = result.preRebaseCommit?.slice(0, 8) ?? '(unknown)'
    const postSha = result.postRebaseCommit?.slice(0, 8) ?? sha
    lines.push(`Attempt ${attemptId} approve --rebase succeeded`)
    lines.push(`pre-rebase commit:  ${preSha}`)
    lines.push(`post-rebase commit: ${postSha}`)
    lines.push(`rebaseNeeded: ${result.rebaseNeeded === true}`)
    lines.push(`verify passed: ${result.verifyPassed === true}`)
    lines.push(`merged ${branch} ${sha}${pushed}`)
  } else {
    lines.push(`Attempt ${attemptId} approve --rebase failed: ${result.reason ?? 'unknown'}`)
    lines.push(`phase: ${formatAttemptPhase(result.stage)}`)
    if (result.fixRebaseTaskId != null) {
      lines.push(`fix-rebase task dispatched: ${result.fixRebaseTaskId.slice(0, 8)}`)
      lines.push('Wait for the fix-rebase Task to land, then re-run `approve --rebase`.')
    }
    if (result.verifyPassed === false && result.verifyOutput != null) {
      lines.push('verify output (truncated):')
      lines.push(result.verifyOutput.slice(0, 1_500))
    }
  }
  ctx.write(result, lines.join('\n'))
}

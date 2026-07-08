import { Command } from 'commander'

import { formatRunLabel, formatStatusBadge, formatSummaryRows } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliContext, CliProgramDeps } from '../runtime.js'
import { requireAgentByName } from './common.js'
import { buildAttemptStartCommand, withDuctum } from './attempt-actions.js'
import { resolveTaskByName, streamRunProgress } from './run-dispatch.js'
import { formatAttemptPhase } from './status-overview.js'

interface AttemptStartOptions {
  agent: string
  project?: string
  spec?: string
}

interface ExtendOptions {
  by: string
  reason?: string
}

interface DenyOptions {
  reason: string
}

interface RedirectOptions {
  agent: string
  reason: string
}

export function registerAttemptCommands(program: Command, deps: CliProgramDeps) {
  const attempt = program.command('attempt').description('Start and inspect Task Attempts')
  registerAttemptStartCommand(attempt, deps, 'start', 'Start an Attempt for a Task')
  registerAttemptRecoveryCommands(attempt, deps)
}

function registerAttemptStartCommand(
  parent: Command,
  deps: CliProgramDeps,
  name: string,
  description: string,
) {
  parent
    .command(`${name} <taskIdOrName>`)
    .requiredOption('--agent <name>', 'Agent name')
    .option('--project <name>', 'Project name (disambiguates duplicate Task names)')
    .option('--spec <name>', 'Spec name (disambiguates duplicate Task names inside a Project)')
    .description(description)
    .action(createAction(deps, async (ctx, task: string, options: AttemptStartOptions) => {
      await startAttempt(ctx, task, options)
    }))
}

async function startAttempt(ctx: CliContext, task: string, options: AttemptStartOptions): Promise<void> {
  const { task: resolvedTask, projectName } = await resolveTaskByName(ctx.api, task, options.project, options.spec)
  const agent = await requireAgentByName(ctx.api, options.agent)

  ctx.writeText(`Starting Attempt for "${resolvedTask.name}" with agent "${agent.name}"...`)
  const attempt = await ctx.api.dispatch(resolvedTask.id, agent.id)
  const label = formatRunLabel(projectName, resolvedTask.name, attempt.id)
  // #275: print the FULL attempt ID alongside the short label so operators
  // can copy/paste it into follow-up commands (cancel, retry, logs, status).
  // The label uses shortId for human display, but cancel/retry/logs require
  // the full ID — printing both removes the mismatch.
  ctx.writeText(`Attempt ${label} created (phase: ${formatAttemptPhase(attempt.stage)})`)
  ctx.writeText(`Attempt ID: ${attempt.id}`)

  const { run: finalAttempt, followup } = await streamRunProgress(ctx, attempt.id)
  if (followup != null) {
    ctx.write(finalAttempt, [
      '',
      `Attempt ${label} handed off to ${followup.task.name} (${followup.task.status}).`,
      `Next: ${withDuctum(buildAttemptStartCommand(followup))}`,
    ].join('\n'))
    return
  }

  const success = finalAttempt.stage === 'done' && finalAttempt.terminalState == null
  const displayState = finalAttempt.terminalState ?? finalAttempt.stage
  const finalLabel = formatRunLabel(projectName, resolvedTask.name, finalAttempt.id)
  ctx.write(finalAttempt, `\nAttempt ${finalLabel} finished: ${formatAttemptPhase(displayState)}`)
  ctx.writeText(`Attempt ID: ${finalAttempt.id}`)

  if (!success) {
    throw new Error(`Attempt ${finalLabel} ${formatAttemptPhase(displayState).toLowerCase()}`)
  }
}

function registerAttemptRecoveryCommands(parent: Command, deps: CliProgramDeps) {
  parent
    .command('cleanup <attemptId>')
    .option('--worktree', 'Remove the preserved terminal-attempt worktree and generated artifacts', false)
    .description('Clean a terminal failed, cancelled, or paused Attempt worktree when policy allows it')
    .action(createAction(deps, async (ctx, attemptId: string, options: { worktree?: boolean }) => {
      if (options.worktree !== true) throw new Error('required option missing: --worktree')
      const result = await ctx.api.cleanupRunWorktree(attemptId)
      ctx.write(result, formatSummaryRows({
        attempt: result.run.id,
        result: formatAttemptPhase(result.run.terminalState ?? result.run.stage),
        cleanedWorktrees: String(result.removedWorktreePaths.length),
        generatedPaths: String(result.generatedPaths.filter((item) => item.outcome === 'removed').length),
        removedBranches: String(result.branchOutcomes.filter((item) => item.outcome === 'removed').length),
      }))
    }))

  parent
    .command('pause <attemptId>')
    .requiredOption('--reason <text>', 'Operator reason for pausing the Attempt')
    .description('Pause an active Attempt without discarding its worktree')
    .action(createAction(deps, async (ctx, attemptId: string, options: DenyOptions) => {
      const reason = requireReason(options.reason)
      const run = await ctx.api.pauseRun(attemptId, reason)
      ctx.write(run, formatSummaryRows({
        attempt: run.id,
        phase: formatAttemptPhase(run.stage),
        result: run.terminalState == null ? '-' : formatAttemptPhase(run.terminalState),
      }))
    }))

  parent
    .command('resume <attemptId>')
    .requiredOption('--reason <text>', 'Operator reason for resuming the paused Attempt')
    .description('Resume a paused Attempt by returning its Task to ready')
    .action(createAction(deps, async (ctx, attemptId: string, options: DenyOptions) => {
      const reason = requireReason(options.reason)
      const result = await ctx.api.resumeRun(attemptId, reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        taskStatus: formatStatusBadge(result.taskStatus),
      }))
    }))

  parent
    .command('redirect <attemptId>')
    .requiredOption('--agent <name>', 'Agent name to receive the Task')
    .requiredOption('--reason <text>', 'Operator reason for redirecting the Attempt')
    .description('Stop an active Attempt and return its Task to ready for another agent')
    .action(createAction(deps, async (ctx, attemptId: string, options: RedirectOptions) => {
      const reason = requireReason(options.reason)
      const agent = await requireAgentByName(ctx.api, options.agent)
      const result = await ctx.api.redirectRun(attemptId, agent.id, reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        toAgent: result.toAgentName,
        taskStatus: formatStatusBadge(result.taskStatus),
      }))
    }))

  parent
    .command('budget-extend <attemptId>')
    .requiredOption('--by <usd>', 'USD to add to the Task budget cap')
    .option('--reason <text>', 'Operator reason for extending the budget')
    .description('Extend a budget-paused Attempt and return its Task to ready')
    .action(createAction(deps, async (ctx, attemptId: string, options: ExtendOptions) => {
      const byUsd = parsePositiveNumber(options.by, '--by')
      const result = await ctx.api.budgetExtend(attemptId, byUsd, options.reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        budgetExtraUsd: `$${result.budgetExtraUsd.toFixed(2)}`,
        result: 'ready',
      }))
    }))

  parent
    .command('budget-deny <attemptId>')
    .requiredOption('--reason <text>', 'Operator reason for denying the budget extension')
    .description('Deny a budget-paused Attempt extension')
    .action(createAction(deps, async (ctx, attemptId: string, options: DenyOptions) => {
      const reason = requireReason(options.reason)
      const result = await ctx.api.budgetDeny(attemptId, reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        result: result.failReason ?? 'budget denied',
      }))
    }))

  parent
    .command('turns-extend <attemptId>')
    .requiredOption('--by <count>', 'Turns to add to the Task turn cap')
    .option('--reason <text>', 'Operator reason for extending turns')
    .description('Extend a max-turns-paused Attempt and return its Task to ready')
    .action(createAction(deps, async (ctx, attemptId: string, options: ExtendOptions) => {
      const byCount = parsePositiveInteger(options.by, '--by')
      const result = await ctx.api.turnsExtend(attemptId, byCount, options.reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        turnExtraCount: String(result.turnExtraCount),
        result: 'ready',
      }))
    }))

  parent
    .command('turns-deny <attemptId>')
    .requiredOption('--reason <text>', 'Operator reason for denying the turn extension')
    .description('Deny a max-turns-paused Attempt extension')
    .action(createAction(deps, async (ctx, attemptId: string, options: DenyOptions) => {
      const reason = requireReason(options.reason)
      const result = await ctx.api.turnsDeny(attemptId, reason)
      ctx.write(result, formatSummaryRows({
        attempt: result.runId,
        task: result.taskId,
        result: result.failReason ?? 'turns denied',
      }))
    }))
}

function parsePositiveNumber(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`)
  return parsed
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`)
  return parsed
}

function requireReason(value: string | undefined): string {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') throw new Error('required option missing: --reason <text>')
  return trimmed
}

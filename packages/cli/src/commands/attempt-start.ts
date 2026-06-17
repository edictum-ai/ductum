import { Command } from 'commander'

import { formatRunLabel } from '../format.js'
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

export function registerAttemptCommands(program: Command, deps: CliProgramDeps) {
  const attempt = program.command('attempt').description('Start and inspect Task Attempts')
  registerAttemptStartCommand(attempt, deps, 'start', 'Start an Attempt for a Task')
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
  ctx.writeText(`Attempt ${label} created (phase: ${formatAttemptPhase(attempt.stage)})`)

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

  if (!success) {
    throw new Error(`Attempt ${finalLabel} ${formatAttemptPhase(displayState).toLowerCase()}`)
  }
}

import { Command } from 'commander'

import { formatSummaryRows } from '../format.js'
import { createAction, type CliProgramDeps } from '../runtime.js'
import type { RunCancelResult } from '../types.js'
import { formatAttemptPhase } from './status-overview.js'

interface CancelOptions {
  reason?: string
  cleanupWorktree?: boolean
  help?: boolean
}

export function registerCancelCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('cancel [attemptId]')
    .option('--reason <text>', 'Operator reason for cancelling the live Attempt')
    .option('--cleanup-worktree', 'Remove the Attempt worktree instead of preserving it', false)
    .option('-h, --help', 'display help for command')
    .description('Cancel a non-terminal Attempt and free its activity slot')
    .action(createAction(deps, async (ctx, attemptId: string | undefined, options: CancelOptions) => {
      if (options.help === true) {
        ctx.writeEnvelope('cli.help', cancelHelpData, formatCancelHelp())
        return
      }
      if (attemptId == null || attemptId.trim() === '') {
        throw new Error('missing required argument: attemptId')
      }
      if (options.reason == null || options.reason.trim() === '') {
        throw new Error('required option missing: --reason <text>')
      }
      const result = await ctx.api.cancelRun(attemptId, {
        reason: options.reason,
        cleanupWorktree: options.cleanupWorktree === true,
      })
      ctx.writeEnvelope('run.cancelled', result, formatCancel(result))
    }))
}

const cancelHelpData = {
  command: 'ductum cancel',
  usage: 'ductum cancel [options] <attemptId>',
  description: 'Cancel a non-terminal Attempt and free its activity slot',
  arguments: [
    { name: 'attemptId', required: true, description: 'Attempt ID to cancel' },
  ],
  options: [
    { flags: '--reason <text>', description: 'Operator reason for cancelling the live Attempt' },
    {
      flags: '--cleanup-worktree',
      description: 'Remove the Attempt worktree instead of preserving it',
      defaultValue: false,
    },
    { flags: '-h, --help', description: 'display help for command' },
  ],
}

function formatCancelHelp(): string {
  return [
    'Usage: ductum cancel [options] <attemptId>',
    '',
    'Cancel a non-terminal Attempt and free its activity slot',
    '',
    'Options:',
    '  --reason <text>     Operator reason for cancelling the live Attempt',
    '  --cleanup-worktree  Remove the Attempt worktree instead of preserving it (default: false)',
    '  -h, --help          display help for command',
  ].join('\n')
}

function formatCancel(result: RunCancelResult): string {
  // #275: surface the process-cleanup outcome so operators can see when
  // an orphan worker was reaped and when reaping failed. Failures leave
  // the run cancelled at the state-machine level but flag a follow-up.
  const cleanup = result.processCleanup
  const cleanupSummary = cleanup == null
    ? '-'
    : cleanup.method === 'active-session'
      ? 'live session killed'
      : cleanup.method === 'orphan-fallback'
        ? cleanup.orphan == null
          ? 'orphan reaper (no mapping)'
          : `${cleanup.orphan.outcome}${cleanup.orphan.outcome === 'failed' ? `: ${cleanup.orphan.reason}` : ''}`
        : 'no active session or mapping'
  return formatSummaryRows({
    attempt: result.run.id,
    phase: formatAttemptPhase(result.run.stage),
    result: result.run.terminalState == null ? '' : formatAttemptPhase(result.run.terminalState),
    worktree: result.worktreePreserved ? 'preserved' : 'removed',
    cleanupAt: result.cleanupAt ?? '-',
    processCleanup: cleanupSummary,
    cost: `$${result.cost.usd.toFixed(4)}`,
  })
}

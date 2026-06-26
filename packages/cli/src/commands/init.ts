import { Command, CommanderError } from 'commander'

import { createAction, type CliContext, type CliProgramDeps } from '../runtime.js'
import { InitCommandError, writeInitError } from '../init/errors.js'
import { writeInitCancelled } from '../init/events.js'
import { formatInitHelp, initHelpData } from '../init/help.js'
import { runHumanInit } from '../init/human.js'
import type { InitOptions } from '../init/options.js'
import { runStructuredInit } from '../init/structured.js'

export function registerInitCommand(program: Command, deps: CliProgramDeps) {
  program
    .command('init')
    .helpOption(false)
    .description('Create a local Ductum factory directory and apply its initial configuration')
    .option('--dir <path>', 'Install directory. Defaults to ~/.ductum/factories.')
    .option('--name <projectName>', 'Project name. Defaults to default.')
    .option('--no-git', 'Skip git init and the initial commit')
    .option('--login', 'Run auth acquisition during init')
    .option('--no-login', 'Skip auth acquisition during init')
    .option('--no-browser', 'Do not open the browser; print the dashboard URL and pairing link')
    .option('--resume', 'Resume init at the Claude auth step')
    .option('-h, --help', 'display help for command')
    .action(createAction(deps, async (ctx, options: InitOptions = {}) => {
      if (options.help === true) {
        ctx.writeEnvelope('cli.help', initHelpData, formatInitHelp())
        return
      }
      try {
        await runInit(ctx, deps, options)
      } catch (error) {
        if (error instanceof InitCommandError && error.initCode === 'init_cancelled') {
          writeInitCancelled(ctx)
          throw new CommanderError(130, 'init_cancelled', error.message)
        }
        if (error instanceof InitCommandError) writeInitError(ctx, error)
        throw error
      }
    }))
}

async function runInit(ctx: CliContext, deps: CliProgramDeps, options: InitOptions): Promise<void> {
  if (ctx.outputMode === 'human') {
    await runHumanInit(ctx, deps, options)
    return
  }
  await runStructuredInit(ctx, deps, options)
}

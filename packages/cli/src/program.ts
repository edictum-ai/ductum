import { Command, CommanderError } from 'commander'

import { registerAdminCommands } from './commands/admin.js'
import { registerAttemptCommands } from './commands/attempt-start.js'
import { registerCancelCommand } from './commands/cancel.js'
import { registerConfigCommands } from './commands/config.js'
import { registerDashboardCommands } from './commands/dashboard.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerFactoryOpsCommands } from './commands/factory-ops.js'
import { registerFactorySettingsCommands } from './commands/factory-settings.js'
import { registerInitCommand } from './commands/init.js'
import { registerIssueCommands } from './commands/issues.js'
import { registerOnboardCommand } from './commands/onboard.js'
import { registerRepairCommands } from './commands/repair.js'
import { registerRepositoryCommands } from './commands/repositories.js'
import { registerServeCommands } from './commands/serve.js'
import { registerStatusCommands } from './commands/status.js'
import { registerTranscriptCommand } from './commands/transcript.js'
import { registerWatchCommand } from './commands/watch.js'
import { createCliVersionEnvelope, readCliVersion } from './version.js'
import { configureProgramOutput, formatError, loadLocalEnv, normalizeArgv } from './runtime.js'
import type { CliProgramDeps } from './runtime.js'

export function createProgram(deps: CliProgramDeps = {}) {
  const program = new Command()
  configureProgramOutput(program, deps)
  program
    .name('ductum')
    .description('Ductum factory control plane: Projects, Specs, Tasks, Attempts, Factory Activity, and Factory Settings')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride()
    .option('--api-url <url>', 'Ductum API URL')
    .option('--json', 'Output JSON')
    .option('--ndjson', 'Output newline-delimited JSON')
    .option('--human', 'Output human-readable text')
    .option('-V, --version', 'Output version')
  addOperatorHelp(program)

  registerAdminCommands(program, deps)
  registerAttemptCommands(program, deps)
  registerCancelCommand(program, deps)
  registerConfigCommands(program, deps)
  registerDashboardCommands(program, deps)
  registerDoctorCommand(program, deps)
  registerFactoryOpsCommands(program, deps)
  registerFactorySettingsCommands(program, deps)
  registerInitCommand(program, deps)
  registerIssueCommands(program, deps)
  registerOnboardCommand(program, deps)
  registerRepairCommands(program, deps)
  registerRepositoryCommands(program, deps)
  registerServeCommands(program, deps)
  registerStatusCommands(program, deps)
  registerTranscriptCommand(program, deps)
  registerWatchCommand(program, deps)

  return program
}

export async function runCli(argv: string[], deps: CliProgramDeps = {}) {
  if (deps.env == null) {
    loadLocalEnv()
  }
  const normalizedArgv = normalizeArgv(argv)
  if (isVersionRequest(normalizedArgv)) {
    writeCliVersion(normalizedArgv, deps)
    return 0
  }
  const program = createProgram(deps)
  try {
    await program.parseAsync(normalizedArgv)
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode
    }
    ;(deps.stderr ?? process.stderr).write(`Error: ${formatError(error)}\n`)
    return 1
  }
}

function addOperatorHelp(program: Command): void {
  program.addHelpText('before', [
    'Normal path:',
    '  ductum init --no-login --no-browser',
    '  ductum start --no-browser',
    '  ductum onboard "$PWD"',
    '  ductum project create <name> --repo <path> --merge-mode human',
    '  ductum project agent assign <name> <agent> --role builder',
    '  ductum doctor',
    '  ductum repair',
    '  ductum status',
    '',
  ].join('\n'))
}

function isVersionRequest(argv: string[]): boolean {
  const args = argv.slice(2)
  return args.includes('--version') || args.includes('-V')
}

function writeCliVersion(argv: string[], deps: CliProgramDeps): void {
  const env = deps.env ?? process.env
  const stdout = deps.stdout ?? process.stdout
  const version = readCliVersion()
  const json = argv.includes('--json') || env.DUCTUM_OUTPUT === 'json'
  const ndjson = argv.includes('--ndjson') || env.DUCTUM_OUTPUT === 'ndjson'
  if (json || ndjson) {
    stdout.write(`${JSON.stringify(createCliVersionEnvelope(version))}\n`)
    return
  }
  stdout.write(`${version}\n`)
}

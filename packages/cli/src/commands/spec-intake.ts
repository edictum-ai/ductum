import { Command } from 'commander'

import { formatStatusBadge } from '../format.js'
import { applyImportedSpec } from '../import-handler.js'
import { createAction, writeWarnings } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { loadImportedSpecContractReport } from '../spec-contract-path.js'
import type { SpecContractReport } from '../spec-contract-audit.js'

interface SpecIntakeOptions {
  import?: boolean
  waiveContract?: boolean
}

export function registerSpecIntakeCommand(spec: Command, deps: CliProgramDeps) {
  spec
    .command('intake <projectName> <path>')
    .option('--import', 'Import the spec after the contract gate passes')
    .option('--waive-contract', 'Import despite contract warnings; records the waiver in CLI output')
    .description('Audit a file-backed spec and optionally import it as tasks')
    .action(createAction(deps, async (
      ctx,
      projectName: string,
      path: string,
      options: SpecIntakeOptions,
    ) => {
      const { imported, report } = await loadImportedSpecContractReport(projectName, path)
      const importRequested = options.import === true
      const waived = report.incomplete && options.waiveContract === true
      const blocked = report.incomplete && !waived
      const nextCommands = blocked
        ? blockedNextCommands(projectName, path)
        : readyNextCommands(projectName, path, imported.spec.name, importRequested, waived)

      writeWarnings(ctx, report.warnings)

      if (!importRequested || blocked) {
        ctx.write({
          project: imported.project,
          spec: imported.spec.name,
          importRequested,
          blocked,
          waived,
          contract: report,
          nextCommands,
        }, formatIntakeReport({
          report,
          projectName,
          specName: imported.spec.name,
          path,
          importRequested,
          blocked,
          waived,
          nextCommands,
        }))
        if (blocked) {
          throw new Error(`Spec ${imported.spec.name} contract is incomplete; import not run`)
        }
        return
      }

      const messages: string[] = []
      const result = await applyImportedSpec(ctx.api, imported, {
        onMessage: (message) => {
          messages.push(message)
          if (!ctx.json) ctx.writeText(message)
        },
      })
      ctx.write({
        project: imported.project,
        spec: imported.spec.name,
        importRequested,
        blocked: false,
        waived,
        contract: report,
        import: {
          specId: result.spec.id,
          skipped: result.skipped,
          taskCount: result.tasks.length,
          dependencyCount: result.depCount,
          readyTaskIds: result.readyTaskIds,
        },
        messages,
        nextCommands,
      }, formatImportResult({
        report,
        specName: imported.spec.name,
        waived,
        skipped: result.skipped,
        taskCount: result.tasks.length,
        dependencyCount: result.depCount,
        readyCount: result.readyTaskIds.length,
        nextCommands,
      }))
    }))
}

function formatIntakeReport(input: {
  report: SpecContractReport
  projectName: string
  specName: string
  path: string
  importRequested: boolean
  blocked: boolean
  waived: boolean
  nextCommands: string[]
}) {
  const status = input.blocked
    ? 'Blocked: contract incomplete; task import not run.'
    : input.report.incomplete && input.waived
      ? 'Ready: contract incomplete but waiver supplied; import was not requested.'
      : input.importRequested
      ? 'Ready: contract gate passed.'
      : 'Ready: contract gate passed; import was not requested.'
  return [
    input.report.markdown,
    '',
    `Spec: ${input.projectName}/${input.specName}`,
    `Path: ${input.path}`,
    status,
    ...(input.waived ? ['Waiver: explicit contract waiver supplied.'] : []),
    formatNext(input.nextCommands),
  ].join('\n')
}

function formatImportResult(input: {
  report: SpecContractReport
  specName: string
  waived: boolean
  skipped: boolean
  taskCount: number
  dependencyCount: number
  readyCount: number
  nextCommands: string[]
}) {
  return [
    'Spec intake complete',
    `contract: ${input.report.incomplete ? input.waived ? 'incomplete (waived)' : 'incomplete' : 'complete'}`,
    `spec: ${input.specName}`,
    `import: ${input.skipped ? formatStatusBadge('skipped') : formatStatusBadge('done')}`,
    `tasks: ${input.taskCount}`,
    `dependencies: ${input.dependencyCount}`,
    `ready: ${input.readyCount}`,
    formatNext(input.nextCommands),
  ].join('\n')
}

function blockedNextCommands(projectName: string, path: string) {
  return [
    `ductum spec intake ${quote(projectName)} ${quote(path)} --import`,
    `ductum spec intake ${quote(projectName)} ${quote(path)} --import --waive-contract`,
  ]
}

function readyNextCommands(
  projectName: string,
  path: string,
  specName: string,
  importRequested: boolean,
  waived: boolean,
) {
  if (!importRequested) {
    return [`ductum spec intake ${quote(projectName)} ${quote(path)} --import${waived ? ' --waive-contract' : ''}`]
  }
  return [
    `ductum task dag ${quote(specName)} --project ${quote(projectName)}`,
    'ductum status',
  ]
}

function formatNext(commands: string[]) {
  return [
    'Next:',
    ...commands.map((command) => `  ${command}`),
  ].join('\n')
}

function quote(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

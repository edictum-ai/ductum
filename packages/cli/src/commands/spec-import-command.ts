import { Command } from 'commander'

import { executeSpecImport } from '../import-handler.js'
import { createAction, writeWarnings } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { buildImportedSpecContractReport } from '../spec-contract-audit.js'
import { parseImportPath } from '../spec-import.js'

interface SpecImportOptions {
  project?: string
  repository?: string
  component?: string
  waiveContract?: boolean
}

export function registerSpecImportCommand(spec: Command, deps: CliProgramDeps) {
  spec
    .command('import <path>')
    .option('--project <name>', 'Project name (required for directory imports)')
    .option('--repository <ref>', 'Default repository name, id, local path, or remote URL for imported tasks')
    .option('--component <ref>', 'Default component name, id, or path for imported tasks')
    .option('--waive-contract', 'Import despite contract warnings; records the waiver in CLI output')
    .description('Import Tasks from a Markdown spec directory (README.md + P*.md); legacy YAML files are historical only, and Attempt history stays separate')
    .action(createAction(deps, async (ctx, path: string, options: SpecImportOptions) => {
      const imported = await parseImportPath(path, options.project)
      const report = buildImportedSpecContractReport(imported)
      const waived = report.incomplete && options.waiveContract === true

      writeWarnings(ctx, report.warnings)

      if (report.incomplete && !waived) {
        const nextCommands = blockedImportNextCommands(imported.project, path, options)
        ctx.write({
          project: imported.project,
          spec: imported.spec.name,
          blocked: true,
          contract: report,
          nextCommands,
        }, formatBlockedImport(imported.project, imported.spec.name, path, report.markdown, nextCommands))
        throw new Error(`Spec ${imported.spec.name} contract is incomplete; import not run`)
      }

      if (waived && !ctx.json) {
        ctx.writeText('Contract incomplete; explicit --waive-contract supplied for spec import.')
      }

      await executeSpecImport(ctx, imported, {
        defaultScope: {
          repository: options.repository,
          component: options.component,
        },
      })
    }))
}

function formatBlockedImport(
  projectName: string,
  specName: string,
  path: string,
  markdown: string,
  nextCommands: string[],
) {
  return [
    markdown,
    '',
    `Spec: ${projectName}/${specName}`,
    `Path: ${path}`,
    'Blocked: contract incomplete; task import not run.',
    'Use spec intake for the normal audited path, or pass --waive-contract when an operator explicitly accepts the gap.',
    'This import creates Tasks only; it does not backfill Attempt history.',
    'Next:',
    ...nextCommands.map((command) => `  ${command}`),
  ].join('\n')
}

function blockedImportNextCommands(projectName: string, path: string, options: SpecImportOptions) {
  const projectArg = options.project == null ? '' : ` --project ${quote(options.project)}`
  const repositoryArg = options.repository == null ? '' : ` --repository ${quote(options.repository)}`
  const componentArg = options.component == null ? '' : ` --component ${quote(options.component)}`
  return [
    `ductum spec intake ${quote(projectName)} ${quote(path)} --import`,
    `ductum spec import ${quote(path)}${projectArg}${repositoryArg}${componentArg} --waive-contract`,
  ]
}

function quote(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

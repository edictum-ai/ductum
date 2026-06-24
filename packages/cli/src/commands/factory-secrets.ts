import { readFile } from 'node:fs/promises'
import type { FactorySecretMetadata } from '@ductum/core'
import { Command } from 'commander'

import { formatSummaryRows, formatTable } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliProgramDeps, CliContext } from '../runtime.js'
import { requireProjectByName } from './common.js'

interface FactorySecretListOptions {
  project?: string
}

interface FactorySecretWriteOptions {
  name?: string
  project?: string
  value?: string
  valueFile?: string
  valueStdin?: boolean
}

export function registerFactorySecretCommands(factory: Command, deps: CliProgramDeps) {
  const secret = factory.command('secret').description('Manage Factory secrets')

  secret
    .command('list')
    .option('--project <projectName>', 'List secrets for a Project')
    .description('List Factory secrets')
    .action(createAction(deps, async (ctx, options: FactorySecretListOptions) => {
      const projectId = await resolveProjectId(ctx, options.project)
      const secrets = await ctx.api.listFactorySecrets(projectId)
      ctx.write(secrets, formatTable(columns(), secrets.map(secretRow)))
    }))

  secret
    .command('create')
    .requiredOption('--name <name>', 'Secret name')
    .option('--project <projectName>', 'Create a Project-scoped secret')
    .option('--value-file <path>', 'Read the secret value from a file')
    .option('--value-stdin', 'Read the secret value from stdin')
    .option('--value <plaintext>', 'Rejected: use --value-file or --value-stdin instead')
    .description('Create a Factory secret')
    .action(createAction(deps, async (ctx, options: FactorySecretWriteOptions) => {
      const secretValue = await readRequiredSecretValue(ctx, options)
      const projectId = await resolveProjectId(ctx, options.project)
      const created = await ctx.api.createFactorySecret({
        name: requireName(options.name, '--name'),
        ...(projectId == null ? {} : { projectId, scope: 'project' }),
        value: secretValue,
      })
      ctx.write(created, formatSummaryRows(secretRow(created)))
    }))

  secret
    .command('update <secretId>')
    .option('--name <name>', 'Secret name')
    .option('--value-file <path>', 'Read the next secret value from a file')
    .option('--value-stdin', 'Read the next secret value from stdin')
    .option('--value <plaintext>', 'Rejected: use --value-file or --value-stdin instead')
    .description('Update or rotate a Factory secret')
    .action(createAction(deps, async (ctx, secretId: string, options: FactorySecretWriteOptions) => {
      const update: { name?: string; value?: string } = {}
      if (options.name != null) update.name = requireName(options.name, '--name')
      const secretValue = await readSecretValue(ctx, options, { optional: true })
      if (secretValue != null) update.value = secretValue
      if (Object.keys(update).length === 0) {
        throw new Error('factory secret update requires --name, --value-file, or --value-stdin')
      }
      const updated = await ctx.api.updateFactorySecret(secretId, update)
      ctx.write(updated, formatSummaryRows(secretRow(updated)))
    }))

  secret
    .command('test <secretId>')
    .description('Test a Factory secret')
    .action(createAction(deps, async (ctx, secretId: string) => {
      const tested = await ctx.api.testFactorySecret(secretId)
      ctx.write(tested, formatSummaryRows(secretRow(tested)))
    }))

  secret
    .command('delete <secretId>')
    .description('Delete a Factory secret')
    .action(createAction(deps, async (ctx, secretId: string) => {
      const existing = await ctx.api.getFactorySecret(secretId)
      await ctx.api.deleteFactorySecret(secretId)
      ctx.write(existing, formatSummaryRows(secretRow(existing)))
    }))
}

async function resolveProjectId(ctx: CliContext, projectName: string | undefined): Promise<string | null | undefined> {
  if (projectName == null) return undefined
  return (await requireProjectByName(ctx.api, projectName)).id
}

async function readSecretValue(
  ctx: Pick<CliContext, 'stdin'>,
  options: FactorySecretWriteOptions,
  flags: { optional?: boolean } = {},
): Promise<string | undefined> {
  if (options.value != null) {
    throw new Error('Plaintext secret values on the command line are rejected; use --value-file or --value-stdin.')
  }
  const sources = Number(Boolean(options.valueFile)) + Number(options.valueStdin === true)
  if (sources > 1) throw new Error('Choose only one of --value-file or --value-stdin')
  if (sources === 0) {
    if (flags.optional === true) return undefined
    throw new Error('Factory secret values must come from --value-file or --value-stdin')
  }
  if (options.valueFile != null) return await readFile(options.valueFile, 'utf8')
  return await readAll(ctx.stdin)
}

async function readRequiredSecretValue(
  ctx: Pick<CliContext, 'stdin'>,
  options: FactorySecretWriteOptions,
): Promise<string> {
  const value = await readSecretValue(ctx, options)
  if (value == null) throw new Error('Factory secret values must come from --value-file or --value-stdin')
  return value
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
  }
  return chunks.join('')
}

function requireName(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (trimmed == null || trimmed === '') throw new Error(`${field} must not be empty`)
  return trimmed
}

function columns() {
  return [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'NAME' },
    { key: 'scope', label: 'SCOPE' },
    { key: 'status', label: 'STATUS' },
    { key: 'lastRotatedAt', label: 'LAST ROTATED' },
    { key: 'lastTestedAt', label: 'LAST TESTED' },
    { key: 'updatedAt', label: 'UPDATED' },
  ]
}

function secretRow(secret: FactorySecretMetadata) {
  return {
    id: secret.id,
    name: secret.name,
    scope: secret.scope,
    status: secret.status,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
    lastRotatedAt: secret.lastRotatedAt ?? '-',
    lastTestedAt: secret.lastTestedAt ?? '-',
  }
}

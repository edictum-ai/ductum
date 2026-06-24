import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Repository, RepositorySpec } from '@ductum/core'
import { Command } from 'commander'

import type { CreateRepositoryInput } from '../types.js'
import { formatSummaryRows, formatTable } from '../format.js'
import { createAction, splitCsv } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import { requireProjectByName } from './common.js'

export interface RepositoryOptions {
  repo: string[]
  localPath?: string
  remoteUrl?: string
  name?: string
  defaultBranch?: string
  branchPrefix?: string
  authRef?: string
}

export function registerRepositoryCommands(program: Command, deps: CliProgramDeps) {
  const repository = program.command('repository').description('Manage Project repositories')
  repository
    .command('list <projectName>')
    .description('List repositories for a Project')
    .action(createAction(deps, async (ctx, projectName: string) => {
      const project = await requireProjectByName(ctx.api, projectName)
      const repositories = await ctx.api.listRepositories(project.id)
      ctx.write(repositories, formatTable(columns(), repositories.map(repositoryRow)))
    }))

  repository
    .command('add <projectName>')
    .option('--repo <path>', 'Local Git repository path', splitCsv, [])
    .option('--local-path <path>', 'Local Git repository path')
    .option('--remote-url <url>', 'Remote repository URL')
    .option('--name <name>', 'Repository name')
    .option('--default-branch <branch>', 'Default branch')
    .option('--branch-prefix <prefix>', 'Branch prefix')
    .description('Add a Repository to a Project')
    .action(createAction(deps, async (ctx, projectName: string, options: RepositoryOptions) => {
      const project = await requireProjectByName(ctx.api, projectName)
      const inputs = repositoryInputsFromOptions(options)
      if (inputs.length !== 1) throw new Error('repository add requires exactly one --repo, --local-path, or --remote-url value')
      const created = await ctx.api.createRepository(project.id, inputs[0]!)
      ctx.write(created, formatSummaryRows(repositoryRow(created)))
    }))

  repository
    .command('update <projectName> <repositoryNameOrId>')
    .option('--remote-url <url>', 'Remote repository URL')
    .option('--local-path <path>', 'Local Git repository path')
    .option('--default-branch <branch>', 'Default branch')
    .option('--branch-prefix <prefix>', 'Branch prefix')
    .option('--auth-ref <ref>', 'Repository auth reference')
    .description('Update a Repository in a Project')
    .action(createAction(deps, async (ctx, projectName: string, repositoryNameOrId: string, options: RepositoryOptions) => {
      const project = await requireProjectByName(ctx.api, projectName)
      const repositories = await ctx.api.listRepositories(project.id)
      const existing = resolveRepository(project.name, repositoryNameOrId, repositories)
      const patch = repositorySpecPatchFromOptions(options)
      if (Object.keys(patch).length === 0) {
        throw new Error('repository update requires at least one of --remote-url, --local-path, --default-branch, --branch-prefix, or --auth-ref')
      }
      const updated = await ctx.api.updateRepository(existing.id, {
        spec: { ...existing.spec, ...patch },
      })
      ctx.write(updated, formatSummaryRows(repositoryRow(updated)))
    }))
}

export function repositoryInputsFromOptions(options: RepositoryOptions): CreateRepositoryInput[] {
  const inputs = [
    ...options.repo.map((repo) => ({ localPath: validateLocalGitRepositoryPath(repo, '--repo') })),
    ...(options.localPath == null ? [] : [{ localPath: validateLocalGitRepositoryPath(options.localPath, '--local-path') }]),
    ...(options.remoteUrl == null ? [] : [{ remoteUrl: options.remoteUrl }]),
  ]
  return inputs.map((input) => ({
    ...input,
    ...(options.name == null ? {} : { name: options.name }),
    ...(options.defaultBranch == null ? {} : { defaultBranch: options.defaultBranch }),
    ...(options.branchPrefix == null ? {} : { branchPrefix: options.branchPrefix }),
  }))
}

export function repositorySpecPatchFromOptions(
  options: Pick<RepositoryOptions, 'remoteUrl' | 'localPath' | 'defaultBranch' | 'branchPrefix' | 'authRef'>,
): Partial<RepositorySpec> {
  const remoteUrl = cleanedOptionValue(options.remoteUrl, '--remote-url')
  const localPath = options.localPath == null ? undefined : validateLocalGitRepositoryPath(options.localPath, '--local-path')
  const defaultBranch = cleanedOptionValue(options.defaultBranch, '--default-branch')
  const branchPrefix = cleanedOptionValue(options.branchPrefix, '--branch-prefix')
  const authRef = cleanedOptionValue(options.authRef, '--auth-ref')
  return {
    ...(remoteUrl == null ? {} : { remoteUrl }),
    ...(localPath == null ? {} : { localPath }),
    ...(defaultBranch == null ? {} : { defaultBranch }),
    ...(branchPrefix == null ? {} : { branchPrefix }),
    ...(authRef == null ? {} : { authRef }),
  }
}

export function resolveRepository(projectName: string, repositoryNameOrId: string, repositories: Repository[]): Repository {
  const byId = repositories.find((candidate) => candidate.id === repositoryNameOrId)
  if (byId != null) return byId
  const matches = repositories.filter((candidate) => candidate.name === repositoryNameOrId)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) {
    const choices = matches.map((candidate) => `  ${candidate.name} [${candidate.id}]`)
    throw new Error(
      `Ambiguous repository "${repositoryNameOrId}" in project ${projectName} — found ${matches.length} matches. Use the repository id:\n${choices.join('\n')}`,
    )
  }
  throw new Error(`Repository not found in project ${projectName}: ${repositoryNameOrId}`)
}

export function validateLocalGitRepositoryPath(path: string, field: string): string {
  const absolute = resolve(path)
  if (!existsSync(absolute)) throw new Error(`${field} must be an existing Git repository path: ${path}`)
  if (!statSync(absolute).isDirectory()) throw new Error(`${field} must be a directory: ${path}`)
  try {
    execFileSync('git', ['-C', absolute, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore', timeout: 1500 })
  } catch {
    throw new Error(`${field} must be an existing Git repository path: ${path}`)
  }
  return absolute
}

function cleanedOptionValue(value: string | undefined, field: string): string | undefined {
  if (value == null) return undefined
  const trimmed = value.trim()
  if (trimmed === '') throw new Error(`${field} must not be empty`)
  return trimmed
}

function columns() {
  return [
    { key: 'id', label: 'ID' },
    { key: 'name', label: 'NAME' },
    { key: 'localPath', label: 'LOCAL PATH' },
    { key: 'remoteUrl', label: 'REMOTE URL' },
    { key: 'readiness', label: 'READINESS' },
  ]
}

function repositoryRow(repository: Repository) {
  return {
    id: repository.id,
    name: repository.name,
    localPath: repository.spec.localPath ?? '-',
    remoteUrl: repository.spec.remoteUrl ?? '-',
    readiness: repository.readiness.supportsLocalWorkflow ? 'local-ready' : 'remote-only',
  }
}

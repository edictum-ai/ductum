import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { createId, type Evidence, type Repository, type Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { ValidationError } from './errors.js'
import { resolveGitHubWriteAuth } from './github-auth.js'
import { upsertGitHubPullRequest } from './github-client.js'
import { buildConventionalPrTitle, buildGitHubPrBody, resolveConventionalBranchName } from './github-lifecycle-format.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl, toHttpsRemoteUrl } from './github-ref.js'

const execFileAsync = promisify(execFile)

export interface GitHubShipSyncResult {
  skipped: boolean
  reason?: string
  branch?: string
  commitSha?: string
  prNumber?: number
  prUrl?: string
}

export interface GitHubShipContext {
  repos: Pick<ApiContext['repos'], 'runs' | 'tasks' | 'specs' | 'repositories' | 'secrets' | 'evidence'>
  factoryDataDir?: string
  now: () => Date
  runGit?: (args: string[]) => Promise<{ stdout: string }>
}

export async function syncGitHubShipArtifacts(context: GitHubShipContext, runId: Run['id']): Promise<GitHubShipSyncResult> {
  const run = requireRun(context, runId)
  const task = requireTask(context, run.taskId)
  const spec = requireSpec(context, task.specId)
  const repository = resolveRepository(context, task.repositoryId)
  if (repository == null) return { skipped: true, reason: 'task has no repository scope' }
  const repoRef = parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repoRef == null) return { skipped: true, reason: 'repository has no GitHub remote' }

  const worktreePath = run.worktreePaths?.find((path) => path.trim() !== '')
  if (worktreePath == null) {
    throw new ValidationError(`Run ${run.id} cannot sync GitHub lifecycle artifacts without a worktree`)
  }

  const branch = resolveConventionalBranchName(spec, task, repository.spec.branchPrefix)
  await renameCurrentBranch(context, worktreePath, branch)
  const commitSha = await readRequiredHead(context, worktreePath)
  context.repos.runs.updateGitArtifacts(run.id, { branch, commitSha })

  const auth = await resolveGitHubWriteAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  await pushBranch(context, worktreePath, repoRef, auth.token, branch)
  context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: run.id,
    type: 'custom',
    payload: {
      kind: 'github-branch-sync',
      repo: `${repoRef.owner}/${repoRef.repo}`,
      branch,
      commitSha,
      actorType: auth.actor.type,
      actorLabel: auth.actor.label,
    },
  })

  const pr = await upsertGitHubPullRequest({
    repo: repoRef,
    token: auth.token,
    headBranch: branch,
    baseBranch: repository.spec.defaultBranch?.trim() || 'main',
    title: buildConventionalPrTitle(spec, task),
    body: buildGitHubPrBody({
      spec,
      task,
      run: context.repos.runs.get(run.id) ?? run,
      branch,
      verificationEvidence: latestVerificationEvidence(context.repos.evidence.list(run.id)),
    }),
    existingPrNumber: run.prNumber,
  })
  context.repos.runs.updateGitArtifacts(run.id, {
    branch,
    commitSha,
    prNumber: pr.number,
    prUrl: pr.html_url,
  })
  context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId: run.id,
    type: 'custom',
    payload: {
      kind: 'github-pr-sync',
      repo: `${repoRef.owner}/${repoRef.repo}`,
      branch,
      prNumber: pr.number,
      prUrl: pr.html_url,
      prTitle: pr.title,
      actorType: auth.actor.type,
      actorLabel: auth.actor.label,
    },
  })
  return { skipped: false, branch, commitSha, prNumber: pr.number, prUrl: pr.html_url }
}

async function renameCurrentBranch(context: GitHubShipContext, worktreePath: string, branch: string): Promise<void> {
  await runGit(context, ['-C', worktreePath, 'branch', '-M', branch])
}

async function readRequiredHead(context: GitHubShipContext, worktreePath: string): Promise<string> {
  const { stdout } = await runGit(context, ['-C', worktreePath, 'rev-parse', 'HEAD'])
  const commitSha = stdout.trim()
  if (commitSha === '') throw new ValidationError(`Could not resolve HEAD commit for ${worktreePath}`)
  return commitSha
}

async function pushBranch(
  context: GitHubShipContext,
  worktreePath: string,
  repo: NonNullable<ReturnType<typeof parseGitHubRepoRef>>,
  token: string,
  branch: string,
): Promise<void> {
  const authHeader = Buffer.from(`x-access-token:${token}`).toString('base64')
  await runGit(context, [
    '-C',
    worktreePath,
    '-c',
    `http.${`https://${repo.host}/`}.extraheader=AUTHORIZATION: basic ${authHeader}`,
    'push',
    toHttpsRemoteUrl(repo),
    `HEAD:refs/heads/${branch}`,
  ])
}

function latestVerificationEvidence(evidence: Evidence[]): Evidence | null {
  const matches = evidence.filter((entry) => entry.type === 'custom' && entry.payload.kind === 'verify')
  return matches.at(-1) ?? null
}

function requireRun(context: GitHubShipContext, runId: Run['id']): Run {
  const run = context.repos.runs.get(runId)
  if (run == null) throw new ValidationError(`Run not found: ${runId}`)
  return run
}

function requireTask(context: GitHubShipContext, taskId: Run['taskId']) {
  const task = context.repos.tasks.get(taskId)
  if (task == null) throw new ValidationError(`Task not found: ${taskId}`)
  return task
}

function requireSpec(context: GitHubShipContext, specId: string) {
  const spec = context.repos.specs.get(specId as never)
  if (spec == null) throw new ValidationError(`Spec not found: ${specId}`)
  return spec
}

function resolveRepository(context: GitHubShipContext, repositoryId: string | null | undefined): Repository | null {
  if (repositoryId == null) return null
  return context.repos.repositories.get(repositoryId as never)
}

async function runGit(context: GitHubShipContext, args: string[]) {
  if (context.runGit != null) return await context.runGit(args)
  return await execFileAsync('git', args, { encoding: 'utf-8', timeout: 60_000 })
}

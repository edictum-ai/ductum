import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log, syncRunGitArtifacts, validateEvidencePayload, type Repository, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth } from '../github-auth.js'
import { fetchGitHubPullRequest } from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { requireRun } from './common.js'
import {
  assertBranchContainsBase,
  assertCleanWorktree,
  branchRefExists,
  checkoutBaseBranch,
  resolveRunGitContext,
} from './merge-context.js'
import { mergeViaLocalBranch, mergeViaPullRequest } from './merge-drivers.js'
import { finalizeSuccessfulMerge } from './merge-finalize.js'
import type { MergeOptions, MergeResult, RunGitContext } from './merge-types.js'
import { hasPrReference, isPrBackedExternalReviewRun, pickPrReference, resolveGitHubPullNumber, resolveKnownBranch } from './merge-utils.js'
import { nonBlank } from './common.js'

export type { MergeOptions, MergeResult } from './merge-types.js'

const execFileAsync = promisify(execFile)

export async function mergeApprovedRun(
  context: ApiContext,
  runId: RunId,
  options: MergeOptions = {},
): Promise<MergeResult> {
  let run = requireRun(context, runId)
  const base = options.base ?? 'main'
  const fallbackUpstreamPath = resolveFallbackUpstreamPath(context, run)
  let git: RunGitContext
  try {
    git = await resolveRunGitContext(run)
  } catch (error) {
    if (isMissingWorktreeError(error) && canUseFallbackBranch(run, fallbackUpstreamPath)) {
      context.repos.runUpdates.create(
        runId,
        'approval worktree was already cleaned up; merging recorded branch from repository path',
      )
      git = { upstreamPath: fallbackUpstreamPath }
    } else if (isMissingWorktreeError(error) && hasZeroDiffWorktreeSnapshot(context, runId)) {
      context.repos.runUpdates.create(runId, 'approved no-op run; recorded worktree was already cleaned up')
      context.stateMachine.markDone(runId, 'approved (missing worktree; zero-diff snapshot)')
      context.dag.onRunComplete(runId)
      context.enforcement.disposeRuntime(runId)
      return { pushed: false }
    } else {
      throw error
    }
  }
  if (!nonBlank(git.upstreamPath) && canUseFallbackBranch(run, fallbackUpstreamPath)) {
    context.repos.runUpdates.create(runId, 'approval has no live worktree; merging recorded branch from repository path')
    git = { ...git, upstreamPath: fallbackUpstreamPath }
  }
  if (nonBlank(git.worktreePath)) {
    const synced = await syncRunGitArtifacts(context.repos.runs, runId, git.worktreePath)
    if (synced != null) run = synced
  }
  await assertCleanWorktree(git.worktreePath)
  if (git.upstreamPath !== git.worktreePath) await assertCleanWorktree(git.upstreamPath, 'merge target')

  const shouldMergePullRequest = hasPrReference(run) || isPrBackedExternalReviewRun(context, runId, run)
  const shouldCheckPrBranch = shouldMergePullRequest && nonBlank(run.commitSha)
  const approvalBase = shouldCheckPrBranch ? await resolvePullRequestMergeBase(context, run, git, base) : base
  if (shouldCheckPrBranch) await assertPrMergeBranchContainsBase(run, git, approvalBase)

  const result = shouldMergePullRequest
    ? await mergeViaPullRequest(run, git, { ...options, base: approvalBase }, runId, context)
    : await mergeViaLocalBranch(context, runId, run, git, options)

  await finalizeSuccessfulMerge(context, runId, result, git, approvalBase)
  return result
}

function resolveFallbackUpstreamPath(context: ApiContext, run: Pick<Run, 'taskId'>): string | undefined {
  const repository = resolveTaskRepository(context, run)
  return repository?.spec.localPath
}

function canUseFallbackBranch(
  run: Pick<Run, 'branch' | 'commitSha'>,
  fallbackUpstreamPath: string | undefined,
): fallbackUpstreamPath is string {
  return nonBlank(fallbackUpstreamPath) && nonBlank(run.branch) && nonBlank(run.commitSha)
}

async function assertPrMergeBranchContainsBase(run: Run, git: RunGitContext, base: string): Promise<void> {
  if (!nonBlank(git.upstreamPath)) return
  const branch = resolveKnownBranch(run, git)
  if (!nonBlank(branch) || branch === base || branch === 'HEAD') return
  if (!await branchRefExists(git.upstreamPath, branch)) return
  await checkoutBaseBranch(git.upstreamPath, base)
  await assertBranchContainsBase(git.upstreamPath, base, branch)
}

async function resolvePullRequestMergeBase(
  context: ApiContext,
  run: Pick<Run, 'taskId' | 'prNumber' | 'prUrl'>,
  git: RunGitContext,
  fallback: string,
): Promise<string> {
  const repository = resolveTaskRepository(context, run)
  const defaultBase = resolveRepositoryDefaultBranch(repository, fallback)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository != null && repoRef != null) {
    if (!hasRepositoryAuthRef(repository) && process.env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim() === 'gh-cli') {
      return await resolveGhCliPullRequestBase(run, git) ?? defaultBase
    }
    const auth = await resolveGitHubReadAuth({
      factoryDir: context.factoryDataDir ?? process.cwd(),
      repository,
      secrets: context.repos.secrets,
      apiBaseUrl: toGitHubApiBaseUrl(repoRef),
    })
    const pull = await fetchGitHubPullRequest({
      repo: repoRef,
      token: auth.token,
      pullNumber: resolveGitHubPullNumber(run, repoRef),
    })
    return nonBlank(pull.base.ref) ? pull.base.ref : defaultBase
  }
  return await resolveGhCliPullRequestBase(run, git) ?? defaultBase
}

function hasRepositoryAuthRef(repository: Repository): boolean {
  return nonBlank(repository.spec.authRef)
}

function resolveTaskRepository(context: ApiContext, run: Pick<Run, 'taskId'>): Repository | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return null
  return context.repos.repositories.get(task.repositoryId as never)
}

function resolveRepositoryDefaultBranch(repository: Repository | null, fallback: string): string {
  const base = repository?.spec.defaultBranch?.trim()
  return base == null || base === '' ? fallback : base
}

async function resolveGhCliPullRequestBase(
  run: Pick<Run, 'prNumber' | 'prUrl'>,
  git: RunGitContext,
): Promise<string | null> {
  if (process.env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim() !== 'gh-cli') return null
  const prRef = pickPrReference(run)
  if (prRef == null) return null
  const cwd = git.upstreamPath ?? git.worktreePath
  const execOptions = { encoding: 'utf-8' as const, timeout: 30_000, ...(cwd == null ? {} : { cwd }) }
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', prRef, '--json', 'baseRefName'], execOptions)
    const view = JSON.parse(stdout) as { baseRefName?: string | null }
    return nonBlank(view.baseRefName) ? view.baseRefName : null
  } catch (error) {
    log.warn('merge', `gh pr view before stale guard failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function hasZeroDiffWorktreeSnapshot(context: ApiContext, runId: RunId): boolean {
  return context.repos.evidence.list(runId).some((item) => {
    const payload = item.payload
    if (!validateEvidencePayload(payload) || payload.kind !== 'worktree.snapshot') return false
    return payload.diffStat.filesChanged === 0
      && payload.diffStat.insertions === 0
      && payload.diffStat.deletions === 0
  })
}

function isMissingWorktreeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('cannot change to')
}

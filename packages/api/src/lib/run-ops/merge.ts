import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log, syncRunGitArtifacts, validateEvidencePayload, type Repository, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth, resolveGitHubWriteAuth } from '../github-auth.js'
import { fetchGitHubPullRequest } from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { requireRun } from './common.js'
import {
  assertCommitContainsBase,
  assertCleanWorktree,
  branchRefExists,
  checkoutBaseBranch,
  resolveRunGitContext,
} from './merge-context.js'
import { mergeViaLocalBranch, mergeViaPullRequest } from './merge-drivers.js'
import { finalizeSuccessfulMerge } from './merge-finalize.js'
import type { MergeOptions, MergeResult, RunGitContext } from './merge-types.js'
import { hasPrReference, isPrBackedExternalReviewRun, pickPrReference, resolveGitHubPullNumber } from './merge-utils.js'
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
  const approvalRefs = shouldCheckPrBranch ? await resolvePullRequestMergeRefs(context, run, git, base) : { base, baseSha: null, head: null }
  assertProtectedBranchWritePolicy(run, approvalRefs.base, shouldMergePullRequest)
  if (shouldCheckPrBranch) await assertPrMergeCommitContainsBase(run.commitSha, approvalRefs, git)

  const result = shouldMergePullRequest
    ? await mergeViaPullRequest(run, git, { ...options, base: approvalRefs.base }, runId, context)
    : await mergeViaLocalBranch(context, runId, run, git, options)

  await finalizeSuccessfulMerge(context, runId, result, git, approvalRefs.base)
  return result
}

function assertProtectedBranchWritePolicy(
  run: Pick<Run, 'runtimeWorkflowProfile'>,
  base: string,
  shouldMergePullRequest: boolean,
): void {
  const pushPolicy = run.runtimeWorkflowProfile?.push
  if (pushPolicy == null) return
  if (!pushPolicy.protectedBranches.includes(base)) return
  if (pushPolicy.protectedBranchMode === 'merge_gate_only') return
  if (pushPolicy.protectedBranchMode === 'github_pull_request' && shouldMergePullRequest) return
  if (pushPolicy.protectedBranchMode === 'github_pull_request') {
    throw new Error(
      `workflow policy requires GitHub pull-request delivery for protected branch ${base}; record a PR-backed run before approval`,
    )
  }
  throw new Error(`workflow protected branch mode is invalid for ${base}`)
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

async function assertPrMergeCommitContainsBase(commitSha: string | null, refs: PullRequestMergeRefs, git: RunGitContext): Promise<void> {
  if (!nonBlank(git.upstreamPath)) throw new Error(`could not verify PR base ${refs.base}: no local repository path available`)
  if (!nonBlank(commitSha)) return
  const baseRevision = refs.baseSha ?? refs.base
  if (!nonBlank(baseRevision)) return
  if (refs.baseSha == null && !await branchRefExists(git.upstreamPath, refs.base)) return
  await fetchMissingPrMergeObjects(git.upstreamPath, refs, baseRevision, commitSha)
  if (!await branchRefExists(git.upstreamPath, baseRevision)) {
    if (refs.baseSha != null) throw new Error(`could not verify PR base ${refs.base} at ${refs.baseSha}`)
    return
  }
  if (!await branchRefExists(git.upstreamPath, commitSha)) {
    throw new Error(`could not verify PR head ${refs.head ?? commitSha} at ${commitSha}`)
  }
  if (await branchRefExists(git.upstreamPath, refs.base)) await checkoutBaseBranch(git.upstreamPath, refs.base)
  await assertCommitContainsBase(git.upstreamPath, baseRevision, commitSha, refs.head ?? commitSha, refs.base)
}

async function fetchMissingPrMergeObjects(
  upstreamPath: string,
  refs: PullRequestMergeRefs,
  baseRevision: string,
  commitSha: string,
): Promise<void> {
  const missingBase = !await branchRefExists(upstreamPath, baseRevision)
  const missingHead = !await branchRefExists(upstreamPath, commitSha)
  if (missingBase && nonBlank(refs.base)) await fetchOriginRef(upstreamPath, refs.base)
  if (missingHead && nonBlank(refs.head)) await fetchOriginRef(upstreamPath, refs.head)
}

async function fetchOriginRef(upstreamPath: string, ref: string): Promise<void> {
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'fetch', '--no-tags', 'origin', ref],
      { encoding: 'utf-8', timeout: 30_000 },
    )
  } catch (error) {
    log.warn('merge', `fetch of ${ref} before PR stale guard failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
  }
}

interface PullRequestMergeRefs {
  base: string
  baseSha: string | null
  head: string | null
}

async function resolvePullRequestMergeRefs(
  context: ApiContext,
  run: Pick<Run, 'taskId' | 'prNumber' | 'prUrl'>,
  git: RunGitContext,
  fallback: string,
): Promise<PullRequestMergeRefs> {
  const repository = resolveTaskRepository(context, run)
  const defaultBase = resolveRepositoryDefaultBranch(repository, fallback)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository != null && repoRef != null) {
    const writeMode = process.env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim()
    if (!hasRepositoryAuthRef(repository) && writeMode === 'gh-cli') {
      return withDefaultBase(await resolveGhCliPullRequestRefs(run, git), defaultBase)
    }
    if (!hasRepositoryAuthRef(repository) && writeMode === 'pat') {
      const auth = await resolveGitHubWriteAuth({
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
      return refsFromPull(pull, defaultBase)
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
    return refsFromPull(pull, defaultBase)
  }
  return withDefaultBase(await resolveGhCliPullRequestRefs(run, git), defaultBase)
}

function refsFromPull(
  pull: { base: { ref?: string | null; sha?: string | null }; head: { ref?: string | null } },
  defaultBase: string,
): PullRequestMergeRefs {
  return {
    base: nonBlank(pull.base.ref) ? pull.base.ref : defaultBase,
    baseSha: nonBlank(pull.base.sha) ? pull.base.sha : null,
    head: nonBlank(pull.head.ref) ? pull.head.ref : null,
  }
}

function withDefaultBase(refs: PullRequestMergeRefs | null, defaultBase: string): PullRequestMergeRefs {
  if (refs == null) return { base: defaultBase, baseSha: null, head: null }
  return { base: nonBlank(refs.base) ? refs.base : defaultBase, baseSha: refs.baseSha, head: refs.head }
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

async function resolveGhCliPullRequestRefs(
  run: Pick<Run, 'prNumber' | 'prUrl'>,
  git: RunGitContext,
): Promise<PullRequestMergeRefs | null> {
  if (process.env.DUCTUM_GITHUB_DEV_WRITE_MODE?.trim() !== 'gh-cli') return null
  const prRef = pickPrReference(run)
  if (prRef == null) return null
  const cwd = git.upstreamPath ?? git.worktreePath
  const execOptions = { encoding: 'utf-8' as const, timeout: 30_000, ...(cwd == null ? {} : { cwd }) }
  try {
    const { stdout } = await execFileAsync('gh', ['pr', 'view', prRef, '--json', 'baseRefName,baseRefOid,headRefName'], execOptions)
    const view = JSON.parse(stdout) as { baseRefName?: string | null; baseRefOid?: string | null; headRefName?: string | null }
    return {
      base: nonBlank(view.baseRefName) ? view.baseRefName : '',
      baseSha: nonBlank(view.baseRefOid) ? view.baseRefOid : null,
      head: nonBlank(view.headRefName) ? view.headRefName : null,
    }
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

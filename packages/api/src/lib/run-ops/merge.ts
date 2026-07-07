import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { log, syncRunGitArtifacts, validateEvidencePayload, type Repository, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth, resolveGitHubWriteAuth } from '../github-auth.js'
import { fetchGitHubPullRequest } from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { requireRun, nonBlank } from './common.js'
import {
  assertCommitContainsBase,
  assertCleanWorktree,
  branchRefExists,
  checkoutBaseBranch,
  resolveRunGitContext,
} from './merge-context.js'
import { mergeViaLocalBranch, mergeViaPullRequest } from './merge-drivers.js'
import { finalizeSuccessfulMerge } from './merge-finalize.js'
import { assertPullRequestStateMatchesRun } from './merge-pr-state.js'
import type { MergeOptions, MergeResult, RunGitContext } from './merge-types.js'
import { hasPrReference, isPrBackedExternalReviewRun, pickPrReference, resolveGitHubPullNumber } from './merge-utils.js'
import { assertHeadHasCommitsAheadOfBase } from './nonempty-head.js'

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
      return failNoOpApproval(context, runId, 'rejected (missing worktree; zero-diff snapshot)')
    } else {
      throw error
    }
  }
  if (!nonBlank(git.upstreamPath) && canUseFallbackBranch(run, fallbackUpstreamPath)) {
    context.repos.runUpdates.create(runId, 'approval has no live worktree; merging recorded branch from repository path')
    git = { ...git, upstreamPath: fallbackUpstreamPath }
  }
  // Issue #225: decide whether the run is PR-backed BEFORE syncing git
  // artifacts from a possibly-stale preserved worktree. A PR-backed run's
  // recorded commitSha is the authoritative expected PR head (refreshed by
  // guardStalePrHeadApproval in approveRun); a stale local worktree must
  // not overwrite it before the PR merge stale guard runs. The PR merge
  // path pins to run.commitSha via --match-head-commit / expectedHeadSha
  // and never reads the worktree HEAD, so skipping the sync there is safe.
  const shouldMergePullRequest = hasPrReference(run) || isPrBackedExternalReviewRun(context, runId, run)
  if (!shouldMergePullRequest && !nonBlank(git.upstreamPath) && hasZeroDiffWorktreeSnapshot(context, runId)) {
    return failNoOpApproval(context, runId, 'rejected (no worktree; zero-diff snapshot)')
  }
  if (!shouldMergePullRequest && nonBlank(git.worktreePath)) {
    const synced = await syncRunGitArtifacts(context.repos.runs, runId, git.worktreePath)
    if (synced != null) run = synced
  }
  await assertCleanWorktree(git.worktreePath)
  if (git.upstreamPath !== git.worktreePath) await assertCleanWorktree(git.upstreamPath, 'merge target')

  const shouldCheckPrBranch = shouldMergePullRequest && nonBlank(run.commitSha)
  const approvalRefs = shouldCheckPrBranch ? await resolvePullRequestMergeRefs(context, run, git, base) : { base, baseSha: null, head: null, headSha: null }
  if (shouldCheckPrBranch) {
    const prHeadSha = run.commitSha
    if (!nonBlank(prHeadSha)) throw new Error(`could not verify PR head for ${run.id}: missing commitSha`)
    assertPullRequestStateMatchesRun(run, {
      prNumber: typeof run.prNumber === 'number' ? run.prNumber : null,
      headSha: approvalRefs.headSha,
      headBranch: approvalRefs.head,
    })
    await assertPrMergeCommitContainsBase(prHeadSha, approvalRefs, git)
    if (!nonBlank(git.upstreamPath)) {
      throw new Error(`could not verify PR head has commits ahead of ${approvalRefs.base}: no local repository path available`)
    }
    await assertHeadHasCommitsAheadOfBase({
      repoPath: git.upstreamPath,
      base: approvalRefs.baseSha ?? approvalRefs.base,
      head: prHeadSha,
      label: `PR head ${approvalRefs.head ?? prHeadSha}`,
      baseLabel: approvalRefs.base,
    })
  }

  const result = shouldMergePullRequest
    ? await mergeViaPullRequest(run, git, { ...options, base: approvalRefs.base }, runId, context)
    : await mergeViaLocalBranch(context, runId, run, git, options)

  await finalizeSuccessfulMerge(context, runId, result, git, approvalRefs.base)
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

async function fetchMissingPrMergeObjects(upstreamPath: string, refs: PullRequestMergeRefs, baseRevision: string, commitSha: string): Promise<void> {
  const missingBase = !await branchRefExists(upstreamPath, baseRevision)
  if (missingBase && nonBlank(refs.base)) await fetchOriginRef(upstreamPath, refs.base)
  if (!await branchRefExists(upstreamPath, commitSha)) {
    // Issue #292: try the branch ref first; if that does not surface the pinned
    // SHA, fetch the SHA directly so a non-empty PR is not refused.
    if (nonBlank(refs.head)) await fetchOriginRef(upstreamPath, refs.head)
    if (!await branchRefExists(upstreamPath, commitSha)) await fetchOriginRef(upstreamPath, commitSha)
  }
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
  headSha: string | null
}

async function resolvePullRequestMergeRefs(
  context: ApiContext,
  run: Pick<Run, 'id' | 'taskId' | 'prNumber' | 'prUrl'>,
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
        secretAccessLog: context.repos.secretAccessLog,
        secretAccessContext: { runId: run.id },
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
      secretAccessLog: context.repos.secretAccessLog,
      secretAccessContext: { runId: run.id },
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
  pull: { base: { ref?: string | null; sha?: string | null }; head: { ref?: string | null; sha?: string | null } },
  defaultBase: string,
): PullRequestMergeRefs {
  return {
    base: nonBlank(pull.base.ref) ? pull.base.ref : defaultBase,
    baseSha: nonBlank(pull.base.sha) ? pull.base.sha : null,
    head: nonBlank(pull.head.ref) ? pull.head.ref : null,
    headSha: nonBlank(pull.head.sha) ? pull.head.sha : null,
  }
}

function withDefaultBase(refs: PullRequestMergeRefs | null, defaultBase: string): PullRequestMergeRefs {
  if (refs == null) return { base: defaultBase, baseSha: null, head: null, headSha: null }
  return {
    base: nonBlank(refs.base) ? refs.base : defaultBase,
    baseSha: refs.baseSha,
    head: refs.head,
    headSha: refs.headSha ?? null,
  }
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
    const { stdout } = await execFileAsync('gh', ['pr', 'view', prRef, '--json', 'baseRefName,baseRefOid,headRefName,headRefOid'], execOptions)
    const view = JSON.parse(stdout) as { baseRefName?: string | null; baseRefOid?: string | null; headRefName?: string | null; headRefOid?: string | null }
    return {
      base: nonBlank(view.baseRefName) ? view.baseRefName : '',
      baseSha: nonBlank(view.baseRefOid) ? view.baseRefOid : null,
      head: nonBlank(view.headRefName) ? view.headRefName : null,
      headSha: nonBlank(view.headRefOid) ? view.headRefOid : null,
    }
  } catch (error) {
    log.warn('merge', `gh pr view before stale guard failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

// Issue #292: terminating in `failed` distinguishes a zero-diff approval from
// shipped work; the throw lets approveRun's catch surface the failure.
function failNoOpApproval(context: ApiContext, runId: RunId, reason: string): never {
  context.repos.runUpdates.create(runId, `failed no-op approval; ${reason}`)
  context.stateMachine.markFailed(runId, reason)
  context.dag.onRunComplete(runId)
  context.enforcement.disposeRuntime(runId)
  throw new Error(reason)
}

function hasZeroDiffWorktreeSnapshot(context: ApiContext, runId: RunId): boolean {
  return context.repos.evidence.list(runId).some((item) => {
    const payload = item.payload
    return validateEvidencePayload(payload) && payload.kind === 'worktree.snapshot'
      && payload.diffStat.filesChanged === 0 && payload.diffStat.insertions === 0 && payload.diffStat.deletions === 0
  })
}

function isMissingWorktreeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('cannot change to')
}

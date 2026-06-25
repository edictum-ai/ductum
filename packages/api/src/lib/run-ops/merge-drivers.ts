import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { createId, log, type Repository, type Run, type RunId } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubWriteAuth } from '../github-auth.js'
import { mergeGitHubPullRequest } from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { ValidationError } from '../errors.js'
import { nonBlank } from './common.js'
import { assertBranchContainsBase, assertBranchContainsCommit, checkoutBaseBranch } from './merge-context.js'
import type { MergeOptions, MergeResult, PullRequestView, RunGitContext } from './merge-types.js'
import {
  buildMergeSubject,
  ghMergeFlag,
  pickPrReference,
  resolveKnownBranch,
  resolveMergeStrategy,
} from './merge-utils.js'

const execFileAsync = promisify(execFile)

export async function mergeViaLocalBranch(
  context: ApiContext,
  runId: RunId,
  run: Run,
  git: RunGitContext,
  options: MergeOptions,
): Promise<MergeResult> {
  const base = options.base ?? 'main'
  const upstreamPath = git.upstreamPath
  if (!nonBlank(upstreamPath)) {
    context.stateMachine.markDone(runId, 'approved (no worktree to merge)')
    context.dag.onRunComplete(runId)
    context.enforcement.disposeRuntime(runId)
    return { pushed: false }
  }

  const branch = resolveKnownBranch(run, git)
  if (!nonBlank(branch) || branch === base || branch === 'HEAD') {
    throw new Error(`refusing to merge from branch "${branch ?? ''}"`)
  }

  await checkoutBaseBranch(upstreamPath, base)
  await assertBranchContainsBase(upstreamPath, base, branch)
  if (nonBlank(run.commitSha)) {
    await assertBranchContainsCommit(upstreamPath, branch, run.commitSha)
  }

  const { stdout: preMergeHeadOutput } = await execFileAsync(
    'git',
    ['-C', upstreamPath, 'rev-parse', 'HEAD'],
    { encoding: 'utf-8', timeout: 5_000 },
  )
  const preMergeHead = preMergeHeadOutput.trim()

  const mergeMessage = `${buildMergeSubject(runId, branch, run.prNumber)}\n\nApproved via Ductum factory.`
  try {
    await execFileAsync(
      'git',
      ['-C', upstreamPath, 'merge', '--no-ff', '-m', mergeMessage, branch],
      { encoding: 'utf-8', timeout: 30_000 },
    )
  } catch (error) {
    await execFileAsync('git', ['-C', upstreamPath, 'merge', '--abort'], {
      encoding: 'utf-8',
      timeout: 5_000,
    }).catch(() => undefined)
    const stderr = (error as { stderr?: string }).stderr ?? ''
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`git merge failed: ${stderr || msg}`)
  }

  let mergeCommitSha: string | undefined
  try {
    const { stdout: sha } = await execFileAsync(
      'git',
      ['-C', upstreamPath, 'rev-parse', 'HEAD'],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    mergeCommitSha = sha.trim()
    context.repos.runs.updateGitArtifacts(runId, { branch, commitSha: mergeCommitSha })
  } catch {
    // Best-effort.
  }

  let pushed = false
  if (options.push) {
    const pushArgs = ['-C', upstreamPath, 'push']
    if (options.pushTags === true) pushArgs.push('--follow-tags')
    pushArgs.push('origin', base)
    try {
      await execFileAsync('git', pushArgs, { encoding: 'utf-8', timeout: 60_000 })
      pushed = true
    } catch (error) {
      const message = `push of ${base} to origin failed: ${error instanceof Error ? error.message : String(error)}`
      if (options.requirePush === true) {
        await rollbackRequiredPushMerge(upstreamPath, preMergeHead)
        context.repos.runs.updateGitArtifacts(runId, { branch, commitSha: run.commitSha })
        throw new Error(message)
      }
      log.warn('merge', `${message} (non-fatal)`)
    }
  }

  return { commitSha: mergeCommitSha, branch, pushed }
}

async function readHead(upstreamPath: string | null | undefined): Promise<string | null> {
  if (!nonBlank(upstreamPath)) return null
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', upstreamPath, 'rev-parse', 'HEAD'],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    return stdout.trim()
  } catch {
    return null
  }
}

async function rollbackRequiredPushMerge(upstreamPath: string, preMergeHead: string): Promise<void> {
  await execFileAsync(
    'git',
    ['-C', upstreamPath, 'reset', '--hard', preMergeHead],
    { encoding: 'utf-8', timeout: 30_000 },
  )
}

export async function mergeViaPullRequest(
  run: Run,
  git: RunGitContext,
  options: MergeOptions,
  runId: RunId,
  context: ApiContext,
): Promise<MergeResult> {
  const repository = resolveRunRepository(context, run)
  if (repository?.spec.authRef?.trim()) {
    return await mergeViaGitHubApi(run, git, options, runId, context, repository)
  }

  const prRef = pickPrReference(run)
  if (prRef == null) throw new Error('PR-backed merge requires prNumber or prUrl')
  const strategy = resolveMergeStrategy(options.strategy)
  const subject = buildMergeSubject(runId, resolveKnownBranch(run, git), run.prNumber)
  const cwd = git.upstreamPath ?? git.worktreePath
  const execOptions = { encoding: 'utf-8' as const, timeout: 60_000, ...(cwd == null ? {} : { cwd }) }

  const args = ['pr', 'merge', prRef, ghMergeFlag(strategy), '--subject', subject, '--body', 'Approved via Ductum factory.']
  if (nonBlank(run.commitSha)) args.push('--match-head-commit', run.commitSha)

  const preMergeHead = await readHead(git.upstreamPath)
  try {
    await execFileAsync('gh', args, execOptions)
  } catch (error) {
    if (options.requirePush === true && nonBlank(git.upstreamPath) && preMergeHead != null) {
      await rollbackRequiredPushMerge(git.upstreamPath, preMergeHead)
    }
    const stderr = (error as { stderr?: string }).stderr ?? ''
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`gh pr merge failed: ${stderr || msg}`)
  }

  let branch = resolveKnownBranch(run, git)
  let mergeCommitSha: string | undefined
  let prBase = options.base ?? 'main'

  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', prRef, '--json', 'mergeCommit,headRefName,baseRefName'],
      execOptions,
    )
    const view = JSON.parse(stdout) as PullRequestView
    branch = nonBlank(view.headRefName) ? view.headRefName : branch
    prBase = nonBlank(view.baseRefName) ? view.baseRefName : prBase
    mergeCommitSha = nonBlank(view.mergeCommit?.oid) ? view.mergeCommit.oid : undefined
  } catch (error) {
    log.warn('merge', `gh pr view after merge failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
  }

  if (branch != null || mergeCommitSha != null) {
    context.repos.runs.updateGitArtifacts(runId, {
      ...(branch == null ? {} : { branch }),
      ...(mergeCommitSha == null ? {} : { commitSha: mergeCommitSha }),
    })
  }

  if (nonBlank(git.upstreamPath)) {
    try {
      await execFileAsync(
        'git',
        ['-C', git.upstreamPath, 'pull', '--ff-only', 'origin', prBase],
        { encoding: 'utf-8', timeout: 30_000 },
      )
    } catch (error) {
      log.warn('merge', `pull of ${prBase} after gh pr merge failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { commitSha: mergeCommitSha, branch, pushed: false }
}

async function mergeViaGitHubApi(
  run: Run,
  git: RunGitContext,
  options: MergeOptions,
  runId: RunId,
  context: ApiContext,
  repository: Repository,
): Promise<MergeResult> {
  const repoRef = parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repoRef == null) {
    throw new ValidationError(`Repository ${repository.name} has GitHub authRef but no GitHub remote URL`)
  }
  if (typeof run.prNumber !== 'number') {
    throw new Error('PR-backed GitHub API merge requires run.prNumber')
  }

  const strategy = resolveMergeStrategy(options.strategy)
  const subject = buildMergeSubject(runId, run.branch ?? undefined, run.prNumber)
  const body = 'Approved via Ductum factory.'
  const auth = await resolveGitHubWriteAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })

  let response
  try {
    response = await mergeGitHubPullRequest({
      repo: repoRef,
      token: auth.token,
      pullNumber: run.prNumber,
      mergeMethod: strategy,
      commitTitle: subject,
      commitMessage: body,
      ...(nonBlank(run.commitSha) ? { expectedHeadSha: run.commitSha } : {}),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    throw new Error(`GitHub API PR merge failed: ${msg}`)
  }

  context.repos.evidence.create({
    id: createId<'EvidenceId'>(),
    runId,
    type: 'custom',
    payload: {
      kind: 'github-pr-merge',
      repo: `${repoRef.owner}/${repoRef.repo}`,
      prNumber: run.prNumber,
      ...(nonBlank(run.prUrl) ? { prUrl: run.prUrl } : {}),
      mergeMethod: strategy,
      actorType: auth.actor.type,
      actorLabel: auth.actor.label,
    },
  })

  const mergeCommitSha = nonBlank(response.sha) ? response.sha : undefined
  if (mergeCommitSha != null || nonBlank(run.branch)) {
    context.repos.runs.updateGitArtifacts(runId, {
      ...(mergeCommitSha == null ? {} : { commitSha: mergeCommitSha }),
      ...(nonBlank(run.branch) ? { branch: run.branch } : {}),
    })
  }

  if (nonBlank(git.upstreamPath)) {
    const base = options.base ?? 'main'
    try {
      await execFileAsync(
        'git',
        ['-C', git.upstreamPath, 'pull', '--ff-only', 'origin', base],
        { encoding: 'utf-8', timeout: 30_000 },
      )
    } catch (error) {
      log.warn('merge', `pull of ${base} after GitHub API PR merge failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { commitSha: mergeCommitSha, branch: run.branch ?? undefined, pushed: false }
}

function resolveRunRepository(context: ApiContext, run: Pick<Run, 'taskId'>): Repository | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return null
  return context.repos.repositories.get(task.repositoryId as never)
}

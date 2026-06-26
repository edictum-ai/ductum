import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { CICheckResult, Repository, Run } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth } from '../github-auth.js'
import {
  fetchGitHubCommitCheckRuns,
  fetchGitHubCommitStatuses,
  type GitHubCheckRunRecord,
  type GitHubCommitStatusRecord,
} from '../github-client.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../github-ref.js'
import { pickPrReference } from './merge-utils.js'

const execFileAsync = promisify(execFile)

interface RawGhPrCheck {
  bucket?: string | null
  name?: string | null
  state?: string | null
  conclusion?: string | null
}

export async function fetchCurrentPrHeadCiChecks(
  context: ApiContext,
  run: Pick<Run, 'taskId' | 'prUrl' | 'prNumber'>,
  headSha: string,
): Promise<CICheckResult[] | null> {
  const repository = resolveRunRepository(context, run)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository != null && repoRef != null) {
    const auth = await resolveGitHubReadAuth({
      factoryDir: context.factoryDataDir ?? process.cwd(),
      repository,
      secrets: context.repos.secrets,
      apiBaseUrl: toGitHubApiBaseUrl(repoRef),
    })
    const [checkRuns, statuses] = await Promise.all([
      fetchGitHubCommitCheckRuns({ repo: repoRef, token: auth.token, ref: headSha }),
      fetchGitHubCommitStatuses({ repo: repoRef, token: auth.token, ref: headSha }),
    ])
    return [...checkRuns.map(normalizeCheckRun), ...latestStatuses(statuses).map(normalizeCommitStatus)]
  }

  if (process.env.DUCTUM_GITHUB_DEV_READ_MODE?.trim() !== 'gh-cli') return null
  const prRef = pickPrReference(run)
  if (prRef == null) return null
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'checks', prRef, '--json', 'name,state,bucket'],
    { encoding: 'utf-8', timeout: 30_000 },
  )
  return (JSON.parse(stdout) as RawGhPrCheck[]).map(normalizeGhPrCheck)
}

function resolveRunRepository(context: ApiContext, run: Pick<Run, 'taskId'>): Repository | null {
  const task = context.repos.tasks.get(run.taskId)
  if (task?.repositoryId == null) return null
  return context.repos.repositories.get(task.repositoryId as never)
}

function latestStatuses(statuses: GitHubCommitStatusRecord[]): GitHubCommitStatusRecord[] {
  const byContext = new Map<string, GitHubCommitStatusRecord>()
  for (const status of [...statuses].sort(compareNewestStatusFirst)) {
    const context = status.context?.trim() || 'commit-status'
    if (!byContext.has(context)) byContext.set(context, status)
  }
  return [...byContext.values()]
}

function compareNewestStatusFirst(left: GitHubCommitStatusRecord, right: GitHubCommitStatusRecord): number {
  return statusTime(right) - statusTime(left)
}

function statusTime(status: GitHubCommitStatusRecord): number {
  const parsed = Date.parse(status.created_at ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCheckRun(check: GitHubCheckRunRecord): CICheckResult {
  return {
    name: check.name?.trim() || 'unknown',
    status: normalizeStatus(check.status),
    conclusion: normalizeConclusion(check.conclusion),
  }
}

function normalizeCommitStatus(status: GitHubCommitStatusRecord): CICheckResult {
  const state = status.state?.toLowerCase()
  return {
    name: status.context?.trim() || 'commit-status',
    status: state === 'pending' ? 'queued' : 'completed',
    conclusion: state === 'success' ? 'success' : state === 'pending' ? null : 'failure',
  }
}

function normalizeGhPrCheck(check: RawGhPrCheck): CICheckResult {
  return {
    name: check.name?.trim() || 'unknown',
    status: normalizeStatus(check.state),
    conclusion: normalizeConclusion(check.conclusion ?? conclusionFromBucket(check.bucket)),
  }
}

function normalizeStatus(state: string | null | undefined): CICheckResult['status'] {
  const value = (state ?? '').toLowerCase()
  if (value === 'queued' || value === 'pending' || value === 'requested' || value === 'waiting') {
    return 'queued'
  }
  if (value === 'in_progress') return 'in_progress'
  if (value === 'completed' || value === 'success' || value === 'failure' || value === 'neutral'
    || value === 'skipped' || value === 'timed_out' || value === 'cancelled') {
    return 'completed'
  }
  return 'queued'
}

function conclusionFromBucket(bucket: string | null | undefined): string | null | undefined {
  const value = bucket == null ? null : bucket.toLowerCase()
  if (value === 'pass') return 'success'
  if (value === 'fail') return 'failure'
  if (value === 'skipping') return 'skipped'
  if (value === 'pending') return null
  return undefined
}

function normalizeConclusion(conclusion: string | null | undefined): CICheckResult['conclusion'] {
  const value = conclusion == null ? null : conclusion.toLowerCase()
  if (value == null || value === 'success' || value === 'failure') return value
  if (value === 'neutral' || value === 'skipped' || value === 'timed_out') return value
  return 'failure'
}

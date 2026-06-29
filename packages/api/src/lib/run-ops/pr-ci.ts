import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { CICheckResult, Repository, Run } from '@ductum/core'

import type { ApiContext } from '../deps.js'
import { resolveGitHubReadAuth } from '../github-auth.js'
import {
  fetchGitHubBranchRequiredStatusChecks,
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
    return [
      ...latestCheckRunsByName(checkRuns).map(normalizeCheckRun),
      ...latestStatuses(statuses).map(normalizeCommitStatus),
    ]
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

/**
 * Issue #195 review round 3: fetch the required status checks configured on
 * the PR's base branch protection rule. The list is the authoritative source
 * for what the approval gate must see before merging — using it instead of
 * only the observed-check set makes the gate fail closed when a required
 * check has not started yet.
 *
 * Returns:
 *   - `string[]` when branch protection is configured with required checks
 *     (may be empty if protection exists but requires nothing).
 *   - `null` when branch protection is not configured for the base branch
 *     (HTTP 404) — the caller falls back to the observed-checks heuristic.
 *   - Throws on any other GitHub API failure so the gate fails closed with a
 *     concrete reason instead of silently treating the call as "no
 *     requirements".
 *
 * Dev `gh-cli` read mode never has a branch-protection API surface; we
 * return `null` there so dev fixture paths stay on the heuristic.
 */
export async function fetchPrBaseBranchRequiredChecks(
  context: ApiContext,
  run: Pick<Run, 'taskId' | 'prUrl' | 'prNumber'>,
  baseBranch: string,
): Promise<string[] | null> {
  const branch = baseBranch.trim() || 'main'
  const repository = resolveRunRepository(context, run)
  const repoRef = repository == null ? null : parseGitHubRepoRef(repository.spec.remoteUrl ?? '')
  if (repository == null || repoRef == null) return null
  const auth = await resolveGitHubReadAuth({
    factoryDir: context.factoryDataDir ?? process.cwd(),
    repository,
    secrets: context.repos.secrets,
    apiBaseUrl: toGitHubApiBaseUrl(repoRef),
  })
  return await fetchGitHubBranchRequiredStatusChecks({
    repo: repoRef,
    token: auth.token,
    branch,
  })
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

/**
 * Issue #195 review round 2: GitHub reports a fresh check-run record each
 * time a required check is re-run on the same head SHA. Collapsing by name
 * while keeping the first record seen lets a stale earlier success mask a
 * current failure (or a stale failure block a later green rerun). We sort
 * by `id` (monotonic per GitHub) with `started_at`/`completed_at` as
 * fallbacks and keep only the newest record per name.
 */
function latestCheckRunsByName(checks: GitHubCheckRunRecord[]): GitHubCheckRunRecord[] {
  const byName = new Map<string, GitHubCheckRunRecord>()
  for (const check of [...checks].sort(compareNewestCheckRunFirst)) {
    const name = check.name?.trim()
    if (!name) continue
    if (!byName.has(name)) byName.set(name, check)
  }
  return [...byName.values()]
}

function compareNewestCheckRunFirst(left: GitHubCheckRunRecord, right: GitHubCheckRunRecord): number {
  return checkRunAge(right) - checkRunAge(left)
}

/**
 * Larger age = newer run. `id` is the primary signal because GitHub assigns
 * monotonically increasing ids to re-runs. We fall back to `started_at` and
 * then `completed_at` for records that lack an id (older GitHub Enterprise
 * shapes or partial fixtures). Records with no sortable signal land last in
 * the original encounter order so dedupe still keeps something rather than
 * dropping the name entirely.
 */
function checkRunAge(check: GitHubCheckRunRecord): number {
  const idRank = numericIdRank(check.id)
  if (idRank != null) return idRank
  const started = parseTimestamp(check.started_at)
  if (Number.isFinite(started)) return started
  const completed = parseTimestamp(check.completed_at)
  if (Number.isFinite(completed)) return completed
  return Number.NEGATIVE_INFINITY
}

function numericIdRank(id: number | string | null | undefined): number | null {
  if (id == null) return null
  const numeric = typeof id === 'number' ? id : Number.parseInt(String(id), 10)
  return Number.isFinite(numeric) ? numeric : null
}

function parseTimestamp(value: string | null | undefined): number {
  if (value == null || value === '') return Number.NaN
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
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
    startedAt: pickCheckRunStartedAt(check),
  }
}

function normalizeCommitStatus(status: GitHubCommitStatusRecord): CICheckResult {
  const state = status.state?.toLowerCase()
  return {
    name: status.context?.trim() || 'commit-status',
    status: state === 'pending' ? 'queued' : 'completed',
    conclusion: state === 'success' ? 'success' : state === 'pending' ? null : 'failure',
    startedAt: status.created_at ?? null,
  }
}

/**
 * Issue #195 review round 2: retain the check-run start time so the approval
 * classifier can break ties when multiple records share a name (defence in
 * depth — `latestCheckRunsByName` already collapses reruns at fetch time).
 * Prefer `started_at`, then `completed_at` as a fallback for old records.
 */
function pickCheckRunStartedAt(check: GitHubCheckRunRecord): string | null {
  if (check.started_at && check.started_at.trim() !== '') return check.started_at
  if (check.completed_at && check.completed_at.trim() !== '') return check.completed_at
  return null
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

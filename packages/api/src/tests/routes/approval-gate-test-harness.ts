/**
 * Issue #195 shared harness for the approval required-checks gate route
 * tests. Each scenario repeats the same fixture/worktree/run/fetch setup
 * — centralizing it keeps the route test files under the file-size cap
 * without duplicating ~100 LOC of seed boilerplate per case.
 */
import type { CICheckResult, RunId } from '@ductum/core'

import {
  createFixture,
  createId,
  execFileAsync,
  seedBase,
  setupMergeFixture,
  vi,
  type TestFixture,
} from './shared.js'
import { seedFactorySecretDir, seedRepositoryWithAuth } from './github-app-merge-shared.js'
import type { MergeConfig } from '../../lib/deps.js'
import type { GitHubCheckRunRecord } from '../../lib/github-client.js'

export interface ApprovalGateRun {
  fixture: TestFixture
  runId: RunId
  headSha: string
  worktree: string
  cleanup: () => Promise<void>
}

export interface ApprovalGateFixtureOptions {
  /** Optional merge-config override (e.g. named required checks). */
  merge?: MergeConfig
}

export async function seedApprovalGateRun(
  taskName: string,
  options: ApprovalGateFixtureOptions = {},
): Promise<ApprovalGateRun> {
  const mergeFix = await setupMergeFixture()
  const { stdout: head } = await execFileAsync('git', ['-C', mergeFix.worktree, 'rev-parse', 'HEAD'])
  const headSha = head.toString().trim()
  const factoryDir = seedFactorySecretDir()
  const fixture = await createFixture({ factoryDataDir: factoryDir, merge: options.merge })
  const { project, builder, spec } = seedBase(fixture)
  const repository = seedRepositoryWithAuth(fixture, project.id, factoryDir)
  const task = fixture.repos.tasks.create({
    id: createId<'TaskId'>(),
    specId: spec.id,
    repositoryId: repository.id,
    targetId: null,
    componentId: null,
    name: taskName,
    prompt: 'implement',
    repos: ['packages/api'],
    assignedAgentId: builder.id,
    requiredRole: null,
    complexity: null,
    status: 'ready',
    verification: ['pnpm test'],
  })
  const runId = createId<'RunId'>()
  fixture.repos.runs.create({
    id: runId,
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage: 'ship',
    terminalState: null,
    resetCount: 0,
    completedStages: ['understand', 'implement'],
    blockedReason: null,
    pendingApproval: true,
    sessionId: null,
    branch: 'feature/x',
    commitSha: headSha,
    prNumber: 42,
    prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
    worktreePaths: [mergeFix.worktree],
    ciStatus: 'pass',
    reviewStatus: 'pass',
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: new Date().toISOString(),
    heartbeatTimeoutSeconds: 120,
  })
  return {
    fixture,
    runId,
    headSha,
    worktree: mergeFix.worktree,
    cleanup: async () => {
      fixture.close()
      await mergeFix.cleanup()
    },
  }
}

export type ApprovalGateFetchHandler = ReturnType<typeof vi.fn>

/**
 * Issue #195 review round 2: the fetch handler JSON-serializes whatever the
 * test hands it and serves it as the GitHub `/check-runs` payload. Tests that
 * exercise rerun dedupe need to include raw API fields like `id` /
 * `started_at` / `completed_at`, so we accept the GitHub record shape here.
 * The previous `CICheckResult`-only type was technically wrong: the harness
 * serves these as GitHub API records (snake_case, optional `id`), not as
 * normalized CICheckResult values. `CICheckResult` remains assignable to
 * `GitHubCheckRunRecord`, so existing tests keep working unchanged.
 */
export type ApprovalGateCheckRecord = GitHubCheckRunRecord

export interface ApprovalGateFetchOverrides {
  /** When provided, replaces the default green check-runs body. */
  checkRuns?: ApprovalGateCheckRecord[] | (() => ApprovalGateCheckRecord[])
  /**
   * Issue #195 review follow-up: when provided, the check-runs endpoint is
   * served as a multi-page sequence. Each entry is one page of checks; pages
   * after the first are addressed via the GitHub `Link: rel="next"` header.
   * Use this to prove the gate walks past page 1 before classifying.
   */
  checkRunPages?: ApprovalGateCheckRecord[][]
  /**
   * Issue #195 review round 2: when set, every check-runs response advertises
   * a `rel="next"` link — even past the 50-page safety cap. Use this to prove
   * the gate fails closed instead of silently dropping the truncated tail.
   */
  checkRunsUnboundedPagination?: boolean
  /**
   * Issue #195 review round 3: required status checks served by the
   * `/branches/{base}/protection/required_status_checks` endpoint. Pass
   * `null` to simulate "branch protection not configured" (HTTP 404); pass
   * an array (including `[]`) to simulate protection with that required
   * set. When omitted, the harness defaults to 404 so tests that do not
   * care about branch protection stay on the observed-checks heuristic.
   */
  branchProtectionRequiredChecks?: string[] | null
  /**
   * Issue #195 review round 3: base branch the protection endpoint is
   * served for. Defaults to `main` to match the production merge config.
   */
  branchProtectionBranch?: string
  /**
   * Issue #195 review round 3: when set, the protection endpoint responds
   * with the given HTTP status code and the supplied body instead of the
   * normal 200/404 path. Use this to prove the gate fails closed when
   * GitHub returns an unexpected error (5xx, etc.).
   */
  branchProtectionStatusOverride?: { status: number; body?: string }
  /** Mutates the PR view response (e.g. to swap head.sha for stale-head tests). */
  prViewMutator?: (view: Record<string, unknown>) => void
  /** When set, `/pulls/42/merge` returns a successful merge; otherwise it throws. */
  mergeSuccessSha?: string
}

const DEFAULT_GREEN_CHECKS: CICheckResult[] = [
  { name: 'audit', status: 'completed', conclusion: 'success' },
  { name: 'build-and-test', status: 'completed', conclusion: 'success' },
]

/**
 * Builds the standard fetch mock used by the approval-gate route tests.
 * Throws on `/pulls/42/merge` unless `mergeSuccessSha` is provided so that
 * fail-closed cases naturally error out if the gate is bypassed.
 */
export function buildApprovalGateFetch(
  headSha: string,
  title: string,
  overrides: ApprovalGateFetchOverrides = {},
): ApprovalGateFetchHandler {
  const protectionBranch = overrides.branchProtectionBranch ?? 'main'
  return vi.fn(async (url: string) => {
    if (url.endsWith('/access_tokens')) {
      return new Response(JSON.stringify({ token: 'app-token' }), { status: 200 })
    }
    if (url.endsWith('/pulls/42')) {
      const view: Record<string, unknown> = {
        number: 42,
        html_url: 'https://github.com/edictum-ai/ductum/pull/42',
        title,
        head: { ref: 'feature/x' },
        base: { ref: 'main' },
      }
      overrides.prViewMutator?.(view)
      return new Response(JSON.stringify(view), { status: 200 })
    }
    /**
     * Issue #195 review round 3: required status checks from branch
     * protection. Default is HTTP 404 (no protection configured) so tests
     * that do not override stay on the observed-checks heuristic. Tests
     * that override with an array (including `[]`) simulate protection.
     */
    const protectionMatch = url.match(
      new RegExp(`/branches/${protectionBranch}/protection/required_status_checks$`),
    )
    if (protectionMatch) {
      if (overrides.branchProtectionStatusOverride != null) {
        return new Response(
          overrides.branchProtectionStatusOverride.body ?? 'error',
          { status: overrides.branchProtectionStatusOverride.status },
        )
      }
      if (overrides.branchProtectionRequiredChecks == null) {
        return new Response('Branch not protected', { status: 404 })
      }
      return new Response(
        JSON.stringify({ contexts: overrides.branchProtectionRequiredChecks }),
        { status: 200 },
      )
    }
    const checkRunsMatch = url.match(/\/commits\/[^/]+\/check-runs(?:\?([^#]*))?$/)
    if (checkRunsMatch) {
      if (overrides.checkRunPages != null) {
        return serveCheckRunPage(url, checkRunsMatch[1] ?? '', overrides.checkRunPages)
      }
      const checks = typeof overrides.checkRuns === 'function' ? overrides.checkRuns() : overrides.checkRuns
      const body = { check_runs: checks ?? DEFAULT_GREEN_CHECKS }
      const headers: Record<string, string> = {}
      // Issue #195 review round 2: pretend GitHub always has one more page so
      // the walker hits its 50-page cap with rel="next" still advertised.
      if (overrides.checkRunsUnboundedPagination === true) {
        const basePath = url.split('?')[0]!
        const params = new URLSearchParams(checkRunsMatch[1] ?? '')
        const next = Math.max(1, Number(params.get('page') ?? '1')) + 1
        headers.link = `<${basePath}?per_page=100&page=${next}>; rel="next"`
      }
      return new Response(JSON.stringify(body), { status: 200, headers })
    }
    if (url.includes(`/commits/${headSha}/statuses?per_page=100`)) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.endsWith('/pulls/42/merge')) {
      if (overrides.mergeSuccessSha == null) throw new Error(`unexpected merge fetch: ${url}`)
      return new Response(JSON.stringify({ sha: overrides.mergeSuccessSha, merged: true }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/**
 * Serves one page of a multi-page check-runs response. Page 1 is requested
 * without a `page=` query param; later pages arrive with `page=N` driven by
 * the `Link: rel="next"` header we returned on the previous page. The final
 * page omits the Link header so the walker terminates.
 */
function serveCheckRunPage(
  url: string,
  search: string,
  pages: ApprovalGateCheckRecord[][],
): Response {
  const params = new URLSearchParams(search)
  const pageIndex = Math.max(1, Number(params.get('page') ?? '1'))
  const pageItems = pages[pageIndex - 1] ?? []
  const headers: Record<string, string> = {}
  if (pageIndex < pages.length) {
    const basePath = url.split('?')[0]!
    headers.link = `<${basePath}?per_page=100&page=${pageIndex + 1}>; rel="next"`
  }
  return new Response(JSON.stringify({ check_runs: pageItems }), { status: 200, headers })
}

/** Returns true if the captured fetch calls hit `/pulls/42/merge`. */
export function capturedMergeCalls(handler: ApprovalGateFetchHandler): string[] {
  return handler.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.endsWith('/pulls/42/merge'))
}

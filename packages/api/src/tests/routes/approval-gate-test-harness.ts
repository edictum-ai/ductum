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

export interface ApprovalGateFetchOverrides {
  /** When provided, replaces the default green check-runs body. */
  checkRuns?: CICheckResult[] | (() => CICheckResult[])
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
    if (url.endsWith(`/commits/${headSha}/check-runs?per_page=100`)) {
      const checks = typeof overrides.checkRuns === 'function' ? overrides.checkRuns() : overrides.checkRuns
      return new Response(JSON.stringify({ check_runs: checks ?? DEFAULT_GREEN_CHECKS }), { status: 200 })
    }
    if (url.endsWith(`/commits/${headSha}/statuses?per_page=100`)) {
      return new Response(JSON.stringify([]), { status: 200 })
    }
    if (url.endsWith('/pulls/42/merge')) {
      if (overrides.mergeSuccessSha == null) throw new Error(`unexpected merge fetch: ${url}`)
      return new Response(JSON.stringify({ sha: overrides.mergeSuccessSha, merged: true }), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** Returns true if the captured fetch calls hit `/pulls/42/merge`. */
export function capturedMergeCalls(handler: ApprovalGateFetchHandler): string[] {
  return handler.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.endsWith('/pulls/42/merge'))
}

import { describe, expect, it, requestJson, vi } from './shared.js'
import {
  buildApprovalGateFetch,
  capturedMergeCalls,
  seedApprovalGateRun,
} from './approval-gate-test-harness.js'

/**
 * Issue #243: PR-backed completion gate. PR creation alone is not completion.
 * The runtime must keep the run not-done while required checks are pending,
 * missing, stale, failing, or cancelled; route failed/cancelled checks to
 * needs-attention with the conclusion visible; refuse to merge when the PR
 * repository, branch, or head SHA does not match the recorded attempt state;
 * and record the final merged state + merge commit only after a successful
 * GitHub App merge.
 */
describe('API routes — PR-backed completion gate (#243)', () => {
  it('routes a cancelled required check to needs-attention with the conclusion mapped to failure', async () => {
    const fixture = await seedApprovalGateRun('Cancelled CI gate', {
      merge: {
        push: false,
        base: 'main',
        strategy: 'merge',
        approvalCiGate: {
          enabled: true,
          requiredChecks: ['build-and-test'],
          failClosedOnMissing: true,
        },
      },
    })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Cancelled CI gate', {
        checkRuns: [
          // GitHub raw API uses 'cancelled' which the normalizer maps to
          // conclusion='failure' so the gate fails closed with a visible
          // conclusion in the recorded evidence.
          { name: 'build-and-test', status: 'completed', conclusion: 'cancelled' },
          { name: 'audit', status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      const runAfter = fixture.fixture.repos.runs.get(fixture.runId)
      // Run stays pendingApproval → attemptStatus returns 'needs_attention'.
      expect(runAfter?.pendingApproval).toBe(true)
      expect(runAfter?.terminalState).toBeNull()
      const evidence = fixture.fixture.repos.evidence.list(fixture.runId)
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'custom',
          payload: expect.objectContaining({
            kind: 'approval-required-checks',
            passed: false,
            commitSha: fixture.headSha,
            missingRequired: [],
            observed: expect.arrayContaining([
              expect.objectContaining({ name: 'build-and-test', conclusion: 'failure' }),
            ]),
          }),
        }),
      ]))
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('records headSha, mergeCommitSha, merged state, actor identity, and observed checks in merge evidence', async () => {
    const fixture = await seedApprovalGateRun('PR completion evidence')
    try {
      const mergeCommitSha = 'mergefedcba0000111122223333444455556666'
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'PR completion evidence', {
        mergeSuccessSha: mergeCommitSha,
        branchProtectionRequiredChecks: ['audit', 'build-and-test'],
        checkRuns: [
          { name: 'audit', status: 'completed', conclusion: 'success' },
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      const evidence = fixture.fixture.repos.evidence.list(fixture.runId)
      const mergeEvidence = evidence.find((item) => item.payload?.kind === 'github-pr-merge')
      expect(mergeEvidence).toBeDefined()
      expect(mergeEvidence?.payload).toMatchObject({
        kind: 'github-pr-merge',
        repo: 'edictum-ai/ductum',
        prNumber: 42,
        prUrl: 'https://github.com/edictum-ai/ductum/pull/42',
        branch: 'feature/x',
        headSha: fixture.headSha,
        baseBranch: 'main',
        mergeMethod: 'merge',
        merged: true,
        mergeCommitSha,
        actorType: 'github_app',
        requiredChecksSource: 'branch_protection',
        requiredChecks: ['audit', 'build-and-test'],
      })
      // Operator approval identity is recorded separately and linked via runId.
      expect(evidence.some((item) => item.payload?.kind === 'operator-approval')).toBe(true)
      // Observed checks summary must include the green required checks.
      const observed = mergeEvidence?.payload?.observedChecks as Array<{ name: string; conclusion: string }> | undefined
      expect(observed).toBeDefined()
      expect(observed!.some((check) => check.name === 'build-and-test' && check.conclusion === 'success')).toBe(true)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('fails closed without GitHub App auth and does not fall back to gh CLI in the production path', async () => {
    const fixture = await seedApprovalGateRun('No auth production fail-closed')
    try {
      // Strip the authRef from the repository so production merge path
      // cannot resolve GitHub App installation auth. The merge driver
      // must fail closed; no fetch should reach the GitHub API and no
      // gh CLI fallback may run.
      const run = fixture.fixture.repos.runs.get(fixture.runId)
      expect(run).toBeDefined()
      const task = fixture.fixture.repos.tasks.get(run!.taskId)
      expect(task).toBeDefined()
      const repository = task?.repositoryId == null
        ? null
        : fixture.fixture.repos.repositories.get(task.repositoryId as never)
      expect(repository).toBeDefined()
      const { authRef: _drop, ...specWithoutAuth } = repository!.spec
      fixture.fixture.repos.repositories.update(repository!.id, { spec: specWithoutAuth })
      // Sanity check the update took effect.
      expect(fixture.fixture.repos.repositories.get(repository!.id)?.spec.authRef).toBeUndefined()

      const fetchMock = vi.fn(async (url: string) => {
        throw new Error(`unexpected fetch: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toMatch(/missing GitHub App installation auth/i)
      const runAfter = fixture.fixture.repos.runs.get(fixture.runId)
      expect(runAfter?.pendingApproval).toBe(true)
      expect(runAfter?.terminalState).toBeNull()
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)
})

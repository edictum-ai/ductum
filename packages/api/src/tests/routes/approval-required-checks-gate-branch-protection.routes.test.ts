import { describe, expect, it, requestJson, vi } from './shared.js'
import {
  buildApprovalGateFetch,
  capturedMergeCalls,
  seedApprovalGateRun,
} from './approval-gate-test-harness.js'

describe('API routes — approval required-checks branch-protection gate', () => {
  it('blocks the merge when a branch-protection required check has not appeared yet', async () => {
    const fixture = await seedApprovalGateRun('Branch protection missing required')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Branch protection missing required', {
        branchProtectionRequiredChecks: ['audit', 'build-and-test'],
        checkRuns: [{ name: 'audit', status: 'completed', conclusion: 'success' }],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('required check "build-and-test" is missing')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      expect(fixture.fixture.repos.runs.get(fixture.runId)?.pendingApproval).toBe(true)

      const calls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(calls.findIndex((url) =>
        url.endsWith('/branches/main/protection/required_status_checks')))
        .toBeGreaterThanOrEqual(0)

      const evidence = fixture.fixture.repos.evidence.list(fixture.runId)
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'custom',
          payload: expect.objectContaining({
            kind: 'approval-required-checks',
            requiredChecksSource: 'branch_protection',
            missingRequired: ['build-and-test'],
          }),
        }),
      ]))
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('merges when all branch-protection required checks are observed green', async () => {
    const fixture = await seedApprovalGateRun('Branch protection all green')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Branch protection all green', {
        branchProtectionRequiredChecks: ['audit', 'build-and-test'],
        mergeSuccessSha: 'mergeBranchProtectionGreen',
        checkRuns: [
          { name: 'audit', status: 'completed', conclusion: 'success' },
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
          { name: 'optional-lint', status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(capturedMergeCalls(fetchMock).length).toBe(1)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('merges when branch protection explicitly requires no checks', async () => {
    const fixture = await seedApprovalGateRun('Branch protection empty required set')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Branch protection empty required set', {
        branchProtectionRequiredChecks: [],
        mergeSuccessSha: 'mergeBranchProtectionEmpty',
        checkRuns: [
          { name: 'optional-lint', status: 'completed', conclusion: 'failure' },
          { name: 'optional-audit', status: 'in_progress', conclusion: null },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      expect(capturedMergeCalls(fetchMock).length).toBe(1)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('fails closed when the branch-protection endpoint returns an unexpected error', async () => {
    const fixture = await seedApprovalGateRun('Branch protection endpoint error')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Branch protection endpoint error', {
        branchProtectionStatusOverride: { status: 502, body: 'upstream down' },
        checkRuns: [{ name: 'audit', status: 'completed', conclusion: 'success' }],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('could not read required-checks policy from GitHub branch protection')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      expect(fixture.fixture.repos.runs.get(fixture.runId)?.pendingApproval).toBe(true)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)
})

import { describe, expect, it, requestJson, vi } from './shared.js'
import {
  buildApprovalGateFetch,
  capturedMergeCalls,
  seedApprovalGateRun,
} from './approval-gate-test-harness.js'

describe('API routes — approval required-checks pagination gate', () => {
  const requiredMerge = {
    push: false,
    base: 'main',
    strategy: 'merge' as const,
    approvalCiGate: {
      enabled: true,
      requiredChecks: ['build-and-test'],
      failClosedOnMissing: true,
    },
  }

  it('walks GitHub check-runs pagination and blocks when a failing required check sits on a later page', async () => {
    const greenFillers = Array.from({ length: 100 }, (_, i) => ({
      name: `green-check-${i + 1}`,
      status: 'completed' as const,
      conclusion: 'success' as const,
    }))
    const fixture = await seedApprovalGateRun('Paginated CI gate', { merge: requiredMerge })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Paginated CI gate', {
        checkRunPages: [
          greenFillers,
          [
            { name: 'audit', status: 'completed', conclusion: 'success' },
            { name: 'build-and-test', status: 'completed', conclusion: 'failure' },
          ],
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('required check "build-and-test" failed')
      expect(capturedMergeCalls(fetchMock)).toEqual([])

      const calls = fetchMock.mock.calls.map(([url]) => String(url))
      const pageOneIdx = calls.findIndex((url) => url.endsWith(`/commits/${fixture.headSha}/check-runs?per_page=100`))
      const pageTwoIdx = calls.findIndex((url) =>
        url.endsWith(`/commits/${fixture.headSha}/check-runs?per_page=100&page=2`))
      expect(pageOneIdx).toBeGreaterThanOrEqual(0)
      expect(pageTwoIdx).toBeGreaterThan(pageOneIdx)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('merges when paginated check-runs eventually surface all-green required checks', async () => {
    const greenFillers = Array.from({ length: 100 }, (_, i) => ({
      name: `green-check-${i + 1}`,
      status: 'completed' as const,
      conclusion: 'success' as const,
    }))
    const fixture = await seedApprovalGateRun('Paginated green CI merge', { merge: requiredMerge })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Paginated green CI merge', {
        mergeSuccessSha: 'mergePaginatedGreen',
        checkRunPages: [
          greenFillers,
          [
            { name: 'audit', status: 'completed', conclusion: 'success' },
            { name: 'build-and-test', status: 'completed', conclusion: 'success' },
          ],
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      const calls = fetchMock.mock.calls.map(([url]) => String(url))
      const pageTwoIdx = calls.findIndex((url) =>
        url.endsWith(`/commits/${fixture.headSha}/check-runs?per_page=100&page=2`))
      expect(pageTwoIdx).toBeGreaterThanOrEqual(0)
      expect(calls.findIndex((url) => url.endsWith('/pulls/42/merge'))).toBeGreaterThan(pageTwoIdx)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('fails closed when GitHub still advertises rel="next" past the pagination cap', async () => {
    const fixture = await seedApprovalGateRun('Pagination truncation fail-closed', { merge: requiredMerge })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Pagination truncation fail-closed', {
        checkRunsUnboundedPagination: true,
        checkRuns: [
          { name: 'build-and-test', status: 'completed', conclusion: 'success' },
          { name: 'audit', status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toContain('could not read CI checks')
      expect(reason).toContain('pagination truncated')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      expect(fixture.fixture.repos.runs.get(fixture.runId)?.pendingApproval).toBe(true)

      const calls = fetchMock.mock.calls.map(([url]) => String(url))
      expect(calls.findIndex((url) =>
        url.endsWith(`/commits/${fixture.headSha}/check-runs?per_page=100&page=50`)))
        .toBeGreaterThanOrEqual(0)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 120_000)
})

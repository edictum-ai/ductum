import { describe, expect, it, requestJson, vi } from './shared.js'
import {
  buildApprovalGateFetch,
  capturedMergeCalls,
  seedApprovalGateRun,
} from './approval-gate-test-harness.js'

describe('API routes — approval required-checks rerun gate', () => {
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

  it('blocks the merge when a stale success would mask a current failing rerun', async () => {
    const fixture = await seedApprovalGateRun('Rerun dedupe stale success', { merge: requiredMerge })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Rerun dedupe stale success', {
        checkRuns: [
          {
            name: 'build-and-test',
            id: 1001,
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-06-29T16:00:00Z',
          },
          {
            name: 'build-and-test',
            id: 1042,
            status: 'completed',
            conclusion: 'failure',
            started_at: '2026-06-29T16:05:00Z',
          },
          { name: 'audit', id: 1002, status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('required check "build-and-test" failed')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('merges once a re-run turns green even though the older attempt failed', async () => {
    const fixture = await seedApprovalGateRun('Rerun dedupe later green', { merge: requiredMerge })
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Rerun dedupe later green', {
        mergeSuccessSha: 'mergeRerunGreen',
        checkRuns: [
          {
            name: 'build-and-test',
            id: 1001,
            status: 'completed',
            conclusion: 'failure',
            started_at: '2026-06-29T16:00:00Z',
          },
          {
            name: 'build-and-test',
            id: 1042,
            status: 'completed',
            conclusion: 'success',
            started_at: '2026-06-29T16:05:00Z',
          },
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
})

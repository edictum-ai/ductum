import { DUCTUM_APPROVAL_EVIDENCE_PRODUCER, DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD } from '@ductum/core'

import { describe, expect, it, requestJson, vi } from './shared.js'
import {
  buildApprovalGateFetch,
  capturedMergeCalls,
  seedApprovalGateRun,
} from './approval-gate-test-harness.js'

describe('API routes — approval required-checks gate', () => {
  it('blocks the GitHub App merge while required CI checks are still pending', async () => {
    const fixture = await seedApprovalGateRun('Pending CI gate')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Pending CI gate', {
        checkRuns: [
          { name: 'audit', status: 'completed', conclusion: 'success' },
          { name: 'build-and-test', status: 'in_progress', conclusion: null },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toContain('required CI checks are not green')
      expect(reason).toContain('build-and-test')
      expect(reason).toMatch(/in progress|in_progress/)
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      const runAfter = fixture.fixture.repos.runs.get(fixture.runId)
      expect(runAfter?.stage).toBe('ship')
      expect(runAfter?.terminalState).toBeNull()
      expect(runAfter?.pendingApproval).toBe(true)
      expect(runAfter?.failReason).toMatch(/required CI checks are not green/)
      const gateRows = fixture.fixture.repos.gateEvaluations.list(fixture.runId)
      expect(gateRows.some((row) => row.target === 'approval.required_checks' && row.result === 'blocked'))
        .toBe(true)
      const evidence = fixture.fixture.repos.evidence.list(fixture.runId)
      expect(evidence).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'custom',
          payload: expect.objectContaining({
            kind: 'approval-required-checks',
            passed: false,
            commitSha: fixture.headSha,
            source: 'github_pr_approval_gate',
            [DUCTUM_TRUSTED_EVIDENCE_PRODUCER_FIELD]: DUCTUM_APPROVAL_EVIDENCE_PRODUCER,
          }),
        }),
      ]))
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('merges through the GitHub App when required CI checks are completed successfully', async () => {
    const fixture = await seedApprovalGateRun('Green CI merge')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Green CI merge', {
        mergeSuccessSha: 'merge456',
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: true, stage: 'done' })
      const calls = fetchMock.mock.calls.map(([url]) => String(url))
      const checkRunsIdx = calls.findIndex((url) => url.endsWith(`/commits/${fixture.headSha}/check-runs?per_page=100`))
      const mergeIdx = calls.findIndex((url) => url.endsWith('/pulls/42/merge'))
      expect(checkRunsIdx).toBeGreaterThanOrEqual(0)
      expect(mergeIdx).toBeGreaterThan(checkRunsIdx)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('fails closed when no required CI checks are observed for the pinned PR head', async () => {
    const fixture = await seedApprovalGateRun('Missing CI gate')
    try {
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Missing CI gate', { checkRuns: [] })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toContain('no CI checks observed for the pinned PR head')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
      const runAfter = fixture.fixture.repos.runs.get(fixture.runId)
      expect(runAfter?.pendingApproval).toBe(true)
      expect(runAfter?.failReason).toMatch(/no CI checks observed/)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('fails closed when a required check is failing', async () => {
    const fixture = await seedApprovalGateRun('Failing CI gate', {
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
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Failing CI gate', {
        checkRuns: [
          { name: 'build-and-test', status: 'completed', conclusion: 'failure' },
          { name: 'audit', status: 'completed', conclusion: 'success' },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toContain('required check "build-and-test" failed')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('retries successfully after required CI checks turn green', async () => {
    const fixture = await seedApprovalGateRun('Retry after green')
    try {
      let checkRunConclusion: 'success' | null = null
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Retry after green', {
        mergeSuccessSha: 'merge789',
        checkRuns: () => [
          {
            name: 'build-and-test',
            status: checkRunConclusion == null ? 'in_progress' : 'completed',
            conclusion: checkRunConclusion,
          },
        ],
      })
      vi.stubGlobal('fetch', fetchMock)

      const firstResult = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })
      expect(firstResult.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((firstResult.json as Record<string, unknown>).reason)).toContain('is in progress')
      expect(capturedMergeCalls(fetchMock)).toEqual([])

      // CI turns green; the same approval path now merges cleanly.
      checkRunConclusion = 'success'
      const secondResult = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })
      expect(secondResult.json).toMatchObject({ success: true, stage: 'done' })
      expect(capturedMergeCalls(fetchMock).length).toBe(1)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('does not call the GitHub App merge when the pinned PR head is stale', async () => {
    const fixture = await seedApprovalGateRun('Stale head CI gate')
    try {
      const liveHeadSha = 'fedcba9876543210fedcba9876543210fedcba98'
      const fetchMock = buildApprovalGateFetch(fixture.headSha, 'Stale head CI gate', {
        prViewMutator: (view) => {
          ;(view.head as Record<string, unknown>).sha = liveHeadSha
        },
      })
      vi.stubGlobal('fetch', fetchMock)

      const result = await requestJson(fixture.fixture.app, `/api/runs/${fixture.runId}/approve`, { method: 'POST' })

      // Existing stale-head guard fails first (PR head moved) — gate never reached.
      expect(result.response.status).toBe(200)
      expect(result.json).toMatchObject({ success: false, stage: 'ship' })
      expect(String((result.json as Record<string, unknown>).reason))
        .toContain('approval blocked: PR head changed')
      expect(capturedMergeCalls(fetchMock)).toEqual([])
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)

  it('walks GitHub check-runs pagination and blocks when a failing required check sits on a later page', async () => {
    // Issue #195 review follow-up: with >100 check contexts the failing
    // required check would live on page 2 and be silently missed without
    // Link-header pagination. Force 100 green checks on page 1 plus the
    // failing required check on page 2.
    const greenFillers = Array.from({ length: 100 }, (_, i) => ({
      name: `green-check-${i + 1}`,
      status: 'completed' as const,
      conclusion: 'success' as const,
    }))
    const fixture = await seedApprovalGateRun('Paginated CI gate', {
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
      const reason = String((result.json as Record<string, unknown>).reason)
      expect(reason).toContain('required check "build-and-test" failed')
      expect(capturedMergeCalls(fetchMock)).toEqual([])

      // The walker must have hit page 2 — the whole point of the fix.
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

  it('merges through the GitHub App when paginated check-runs eventually surface all-green required checks', async () => {
    // Companion to the previous case: with >100 checks but ALL green (across
    // two pages), the gate should pass and the merge should fire.
    const greenFillers = Array.from({ length: 100 }, (_, i) => ({
      name: `green-check-${i + 1}`,
      status: 'completed' as const,
      conclusion: 'success' as const,
    }))
    const fixture = await seedApprovalGateRun('Paginated green CI merge', {
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
      const mergeIdx = calls.findIndex((url) => url.endsWith('/pulls/42/merge'))
      expect(mergeIdx).toBeGreaterThan(pageTwoIdx)
    } finally {
      vi.restoreAllMocks()
      await fixture.cleanup()
    }
  }, 60_000)
})

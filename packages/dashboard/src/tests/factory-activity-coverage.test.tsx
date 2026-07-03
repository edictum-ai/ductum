import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { FactoryActivity } from '@/pages/FactoryActivity'
import { activitySummaryFixture } from './factory-activity-fixtures'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('FactoryActivity page coverage copy', () => {
  it('pins the subtitle that distinguishes recent feeds from uncapped totals', async () => {
    // Behavior contract #3 (issue #244): recent feed/list counts must
    // not parade as all-factory totals. The subtitle is the canonical
    // place that tells operators the headline numbers come from the
    // uncapped SQL aggregate — not from the latest 500 fetched rows.
    fetchHelper = mockFetch(withSummary())

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory Activity' })).toBeInTheDocument()
    })
    expect(screen.getByText(/Totals use the uncapped factory summary\./)).toBeInTheDocument()
    expect(screen.getByText(/Recent completed attempts/)).toBeInTheDocument()
  })

  it('uses the uncapped aggregate count and labels it as factory-wide when summary is present', async () => {
    // Behavior contract #1 (issue #244): factory-level totals must come
    // from /api/factory/activity-summary, not from useAllRuns caps. With
    // the summary present, the total-attempt metric pill must read 237
    // (uncapped) — not 500 (fetched attempts cap) or 2 (rows returned).
    fetchHelper = mockFetch(withSummary())

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByText('237')).toBeInTheDocument()
    })
    // MetricPill renders `<span title=...><span>label</span><span>value</span></span>`.
    // Reach the title via the label span's parent so the test stays robust
    // to other "0" badges (e.g. Action clear) rendered elsewhere on the page.
    const totalPill = screen.getByText('total attempts').parentElement
    expect(totalPill).toHaveAttribute('title', 'All attempts in the factory database')
  })

  it('falls back to a fetched-window disclosure when the summary is unavailable', async () => {
    // If a future change drops the activity-summary route or the hook
    // stops resolving, the pill must NOT silently show the fetched-row
    // count as a factory total. The title flips to "Derived from the
    // latest 500 fetched attempts." so operators see the scope.
    fetchHelper = mockFetch({
      '/api/factory/operator-brief': operatorBrief(),
      '/api/attempts?limit=500': { attempts: [] },
      '/api/factory/activity-summary': { __status: 500, body: { error: 'summary unavailable' } },
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByText('total attempts')).toBeInTheDocument()
    })
    const fallbackPill = screen.getByText('total attempts').parentElement
    expect(fallbackPill).toHaveAttribute('title', 'Derived from the latest 500 fetched attempts.')
  })
})

function withSummary(): Record<string, unknown> {
  return {
    '/api/factory/operator-brief': operatorBrief(),
    '/api/attempts?limit=500': { attempts: [] },
    '/api/factory/activity-summary': activitySummaryFixture({
      attemptCount: 237,
      cleanDone: 89,
      trackedUsd: 119.7,
      missingUsage: 181,
      costPerCleanDoneLabel: '$1.34',
    }),
  }
}

function operatorBrief() {
  return {
    generatedAt: '2026-07-01T12:00:00.000Z',
    dispatcher: {
      enabled: true,
      running: false,
      activeRuns: 0,
      maxConcurrentRuns: 4,
      lastCycleAt: null,
      adapterCount: 1,
    },
    queue: {
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks: 0,
      readyTaskIds: [],
      needsOperator: 0,
      needsOperatorAttempts: [],
      integrityIssues: 0,
    },
    integrity: {
      readiness: 'clear',
      issueCount: 0,
      taskIssueCount: 0,
      runIssueCount: 0,
      externalTaskCount: 0,
      externalRunCount: 0,
      taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      issues: [],
      issuesTruncated: false,
    },
    telegram: { enabled: false, configured: false },
    agents: [],
    recommendedActions: [],
  }
}

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from '@/App'
import type { FactoryAnalyticsReport, RunUiStatusKey } from '@/api/client'
import { callsOf, mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

describe('factory analytics page', () => {
  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders server-authoritative analytics and report links', async () => {
    fetchHelper = mockFetch(baseResponses())

    renderWithProviders(<App />, { route: '/analytics' })

    expect(await screen.findByRole('heading', { name: 'Factory Analytics' }, { timeout: 20_000 })).toBeInTheDocument()
    expect(await screen.findByText(/\$12\.50 across 2 attempts/)).toBeInTheDocument()
    expect(screen.getByText(/Known spend/)).toBeInTheDocument()
    expect(screen.getAllByText(/Unmeasured/).length).toBeGreaterThan(0)
    expect(screen.getByText('1 attempt has no model telemetry')).toBeInTheDocument()
    expect(screen.getByText('scanner/backfill')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getAllByText('glm').length).toBeGreaterThan(0)
    expect(screen.getAllByText('glm-5.2').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /CSV/ })).toHaveAttribute('href', '/api/factory/analytics/report?range=7d&missingUsage=any_gap&format=csv')
    expect(screen.getByRole('link', { name: /JSON/ })).toHaveAttribute('href', '/api/factory/analytics/report?range=7d&missingUsage=any_gap&format=json')
  })

  it('propagates date range and missing-usage filters to the API', async () => {
    fetchHelper = mockFetch(baseResponses())

    renderWithProviders(<App />, { route: '/analytics' })
    expect(await screen.findByRole('heading', { name: 'Factory Analytics' }, { timeout: 20_000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Last 30 days' }))
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'GET', '/api/factory/analytics?range=30d&missingUsage=any_gap')).toHaveLength(1)
    })

    fireEvent.click(screen.getByRole('radio', { name: 'Price' }))
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'GET', '/api/factory/analytics?range=30d&missingUsage=price_missing')).toHaveLength(1)
    })
  })
})

function baseResponses() {
  return {
    '/api/runs?stage=ship': [],
    '/api/factory/activity-summary': activitySummary(),
    '/api/factory/operator-brief': {
      queue: { needsOperator: 0, needsOperatorAttempts: [], readyTasks: 0, readyTaskIds: [] },
      dispatcher: {},
      integrity: {},
      telegram: {},
      agents: [],
      recommendedActions: [],
    },
    '/api/repair': { summary: { blockers: 0 } },
    '/api/factory/analytics': analyticsReport(),
  }
}

function analyticsReport(): FactoryAnalyticsReport {
  const statusCounts = emptyStatusCounts()
  statusCounts.done = 2
  statusCounts.failed = 1
  return {
    generatedAt: '2026-07-02T00:00:00.000Z',
    range: {
      kind: '7d',
      label: 'Last 7 days',
      from: '2026-06-25T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      days: 7,
      bucket: 'day',
    },
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: 3,
      coverageLabel: 'All attempts in the factory database · known spend, unmeasured, and price missing are separated.',
    },
    headline: {
      attemptCount: 3,
      statusCounts,
      cleanDone: 2,
      cleanDoneRateLabel: '67%',
      cleanDoneRatePct: 0.67,
      attention: 1,
      stalledOrFailed: 1,
      tokensOut: 9000,
      cost: {
        trackedUsd: 12.5,
        measured: 2,
        pending: 0,
        missingPrice: 1,
        missingUsage: 1,
        total: 3,
        valueLabel: '$12.50',
        issueLabel: '1 usage missing · 1 price missing',
        dominantCoverage: 'known',
        hasGap: true,
      },
      costPerCleanDoneUsd: 6.25,
      costPerCleanDoneLabel: '$6.25',
      reviewPasses: 2,
      reviewFailures: 1,
      verificationFailures: 1,
    },
    previousHeadline: null,
    trends: {
      kind: 'day',
      buckets: [
        {
          bucketStart: '2026-07-01T00:00:00.000Z',
          bucketEnd: '2026-07-02T00:00:00.000Z',
          bucketLabel: 'Jul 1',
          attempts: 1,
          cleanDone: 1,
          spendUsd: 12.5,
          stalls: 1,
          failures: 1,
          missingUsage: 1,
          missingPrice: 1,
        },
        {
          bucketStart: '2026-07-02T00:00:00.000Z',
          bucketEnd: '2026-07-03T00:00:00.000Z',
          bucketLabel: 'Jul 2',
          attempts: 3,
          cleanDone: 0,
          spendUsd: 0,
          stalls: 0,
          failures: 0,
          missingUsage: 0,
          missingPrice: 0,
        },
      ],
      spendTotalUsd: 12.5,
      attemptsTotal: 4,
      cleanDoneTotal: 1,
      stallsTotal: 1,
      failuresTotal: 1,
      missingUsageTotal: 1,
      missingPriceTotal: 1,
    },
    perAgent: [breakdown('glm', 'glm', 'glm-5.2')],
    perModel: [breakdown('glm-5.2', 'glm-5.2', null)],
    budget: {
      capUsd: 30,
      spentUsd: 12.5,
      remainingUsd: 17.5,
      burnPctLabel: '42%',
      burnPct: 0.42,
      series: [{ day: '2026-07-01', cumulativeUsd: 12.5, spentUsd: 12.5 }],
      bySpec: [{
        specId: 's1',
        specName: 'analytics',
        projectName: 'ductum',
        capUsd: 30,
        spentUsd: 12.5,
        remainingUsd: 17.5,
        burnPctLabel: '42%',
        burnPct: 0.42,
        attemptCount: 3,
      }],
    },
    missingUsage: {
      totalAttempts: 1,
      coverageKind: 'any_gap',
      reasonCounts: { operatorRecorded: 0, scannerMissing: 1, priceMissing: 0 },
      rows: [{
        id: 'run1',
        taskName: 'analytics',
        specName: 'analytics',
        projectName: 'ductum',
        agentName: 'glm',
        agentModel: 'glm-5.2',
        stage: 'done',
        terminalState: 'success',
        createdAt: '2026-07-01T00:00:00.000Z',
        coverageKind: 'usage_missing',
        coverageReason: 'scanner_missing',
      }],
      rowsCapped: false,
      rowsCap: 25,
    },
    statusCounts,
  }
}

function breakdown(key: string, label: string, secondaryLabel: string | null) {
  return {
    key,
    label,
    secondaryLabel,
    attemptCount: 3,
    doneCount: 2,
    cleanDone: 2,
    successRateLabel: '67%',
    successRatePct: 0.67,
    costTrackedUsd: 12.5,
    costPerCleanDoneUsd: 6.25,
    costPerCleanDoneLabel: '$6.25',
    reviewPasses: 2,
    reviewFailures: 1,
    verificationFailures: 1,
    missingUsage: 1,
    missingPrice: 1,
  }
}

function activitySummary() {
  return {
    generatedAt: '2026-07-02T00:00:00.000Z',
    source: { kind: 'all_runs', label: 'All attempts in the factory database', capped: false, attemptCount: 3 },
    currentWindow: activityWindow(),
    previousWindow: activityWindow(),
    allTime: activityWindow(),
  }
}

function activityWindow() {
  return {
    label: 'Last 7 days',
    startedAt: '2026-06-25T00:00:00.000Z',
    endedAt: '2026-07-02T00:00:00.000Z',
    attemptCount: 3,
    statusCounts: emptyStatusCounts(),
    cleanDone: 2,
    attention: 0,
    stalledOrFailed: 1,
    tokensOut: 9000,
    cost: {
      trackedUsd: 12.5,
      measured: 2,
      pending: 0,
      missingPrice: 1,
      missingUsage: 1,
      total: 3,
      valueLabel: '$12.50',
      issueLabel: '1 attempt missing usage',
      hasGap: true,
    },
    costPerCleanDoneUsd: 6.25,
    costPerCleanDoneLabel: '$6.25',
  }
}

function emptyStatusCounts(): Record<RunUiStatusKey, number> {
  return {
    running: 0,
    awaiting_review: 0,
    awaiting_approval: 0,
    failed: 0,
    stalled: 0,
    cancelled: 0,
    paused: 0,
    frozen: 0,
    quarantined: 0,
    done: 0,
  }
}

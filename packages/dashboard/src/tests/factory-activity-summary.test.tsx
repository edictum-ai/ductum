import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FactoryActivitySummary, RunUiStatusKey } from '@/api/client'
import { WeekPulse } from '@/components/SidebarSpend'
import { SummaryBar } from '@/components/homepage/RunFeed'
import { renderWithProviders } from './test-utils'

describe('factory activity summary UI', () => {
  it('renders activity headline totals from the uncapped summary', () => {
    render(<SummaryBar runs={[]} attentionCountOverride={4} summary={activitySummaryFixture()} />)

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('89')).toBeInTheDocument()
    expect(screen.getByText('of 237 attempts')).toBeInTheDocument()
    expect(screen.getByText('$119.70')).toBeInTheDocument()
    expect(screen.getByText('42k output tokens · 181 attempts missing usage')).toBeInTheDocument()
  })

  it('renders sidebar weekly spend from the uncapped summary', () => {
    renderWithProviders(<WeekPulse summary={activitySummaryFixture()} />)

    expect(screen.getByText('$74')).toBeInTheDocument()
    expect(screen.getByText('.54')).toBeInTheDocument()
    expect(screen.getByText('$0.83/clean done · +$46.44 vs prior week · 181 attempts missing usage')).toHaveAttribute(
      'title',
      'Clean done means done attempts without execution-integrity issues. All attempts in the factory database',
    )
  })

  it('keeps missing-usage and missing-price labels distinct in the activity summary bar', () => {
    // Behavior contract #2 (issue #244): missing usage and missing price
    // must NOT collapse into $0, "free", or one ambiguous gap label. When
    // the server aggregate reports both gaps, both must be visible — the
    // SummaryBar's issue line is the canonical place this would regress.
    render(<SummaryBar runs={[]} attentionCountOverride={0} summary={bothGapsFixture()} />)

    // The SummaryCard renders `sub` as a single text node joined by "·",
    // so match each gap label via substring regex instead of exact text.
    const sub = screen.getByText(/output tokens/)
    expect(sub.textContent).toMatch(/12 attempts missing usage/)
    expect(sub.textContent).toMatch(/7 attempts missing price/)
    expect(screen.getByText('Tracked cost')).toBeInTheDocument()
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument()
    expect(screen.queryByText(/^\$0\.00$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/free/i)).not.toBeInTheDocument()
    // An ambiguous single-bucket regression would surface as "gap(s)" or
    // "incomplete" — pin against those words so a future copy change
    // that collapses the two states fails this test.
    expect(sub.textContent).not.toMatch(/\bincomplete\b/i)
    expect(sub.textContent).not.toMatch(/^\d+ gap/)
  })

  it('keeps missing-usage and missing-price labels distinct in the sidebar week pulse', () => {
    // SidebarSpend reads `currentWindow.cost.issueLabel` directly. The
    // regression risk is a future fixture/template change that joins the
    // two gaps into one bucket — pin both labels here.
    renderWithProviders(<WeekPulse summary={bothGapsFixture()} />)

    const expectedDetail = /12 attempts missing usage · 7 attempts missing price/
    expect(screen.getByText(expectedDetail)).toBeInTheDocument()
    expect(screen.queryByText(/^\d+ gap/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/incomplete/i)).not.toBeInTheDocument()
  })
})

function activitySummaryFixture(): FactoryActivitySummary {
  return {
    generatedAt: '2026-07-01T12:00:00.000Z',
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: 237,
    },
    currentWindow: windowSummary({
      label: 'Last 7 days',
      attemptCount: 120,
      cleanDone: 90,
      trackedUsd: 74.54,
      missingUsage: 181,
      costPerCleanDoneUsd: 0.8282222222,
      costPerCleanDoneLabel: '$0.83',
    }),
    previousWindow: windowSummary({
      label: 'Previous 7 days',
      attemptCount: 80,
      cleanDone: 40,
      trackedUsd: 28.1,
      missingUsage: 0,
      costPerCleanDoneUsd: 0.7025,
      costPerCleanDoneLabel: '$0.70',
    }),
    allTime: windowSummary({
      label: 'All attempts',
      attemptCount: 237,
      running: 5,
      awaitingApproval: 3,
      cleanDone: 89,
      attention: 110,
      trackedUsd: 119.7,
      missingUsage: 181,
      tokensOut: 42_000,
      costPerCleanDoneUsd: 1.3449,
      costPerCleanDoneLabel: '$1.34',
    }),
  }
}

/**
 * Fixture exercising the both-gaps path: the all-time headline and the
 * current sidebar window both report missing-usage AND missing-price so
 * the dashboard cannot collapse them into a single bucket. Mirrors the
 * server's `costIssueLabel` shape from `factory-activity-summary.ts`.
 */
function bothGapsFixture(): FactoryActivitySummary {
  const allTime = windowSummary({
    label: 'All attempts',
    attemptCount: 50,
    running: 1,
    awaitingApproval: 1,
    cleanDone: 30,
    trackedUsd: 45.2,
    missingUsage: 12,
    missingPrice: 7,
    tokensOut: 8_000,
    costPerCleanDoneUsd: 45.2 / 30,
    costPerCleanDoneLabel: '$1.51',
  })
  return {
    generatedAt: '2026-07-01T12:00:00.000Z',
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: 50,
    },
    currentWindow: allTime,
    previousWindow: windowSummary({
      label: 'Previous 7 days',
      attemptCount: 0,
      cleanDone: 0,
      trackedUsd: 0,
      missingUsage: 0,
      missingPrice: 0,
      costPerCleanDoneUsd: 0,
      costPerCleanDoneLabel: 'n/a',
    }),
    allTime,
  }
}

function windowSummary(input: {
  label: string
  attemptCount: number
  running?: number
  awaitingApproval?: number
  cleanDone: number
  attention?: number
  trackedUsd: number
  missingUsage: number
  missingPrice?: number
  tokensOut?: number
  costPerCleanDoneUsd: number
  costPerCleanDoneLabel: string
}): FactoryActivitySummary['allTime'] {
  const missingPrice = input.missingPrice ?? 0
  const hasGap = input.missingUsage > 0 || missingPrice > 0
  return {
    label: input.label,
    startedAt: '2026-06-24T12:00:00.000Z',
    endedAt: '2026-07-01T12:00:00.000Z',
    attemptCount: input.attemptCount,
    statusCounts: {
      ...emptyStatusCounts(),
      running: input.running ?? 0,
      awaiting_approval: input.awaitingApproval ?? 0,
      done: input.cleanDone,
    },
    cleanDone: input.cleanDone,
    attention: input.attention ?? 0,
    stalledOrFailed: 0,
    tokensOut: input.tokensOut ?? 0,
    cost: {
      trackedUsd: input.trackedUsd,
      measured: Math.max(0, input.attemptCount - input.missingUsage - missingPrice),
      pending: 0,
      missingPrice,
      missingUsage: input.missingUsage,
      total: input.attemptCount,
      valueLabel: `$${input.trackedUsd.toFixed(2)}`,
      issueLabel: buildIssueLabel(input.missingUsage, missingPrice),
      hasGap,
    },
    costPerCleanDoneUsd: input.costPerCleanDoneUsd,
    costPerCleanDoneLabel: input.costPerCleanDoneLabel,
  }
}

function buildIssueLabel(missingUsage: number, missingPrice: number): string {
  return [
    missingUsage > 0 ? `${missingUsage} attempt${missingUsage === 1 ? '' : 's'} missing usage` : null,
    missingPrice > 0 ? `${missingPrice} attempt${missingPrice === 1 ? '' : 's'} missing price` : null,
  ].filter(Boolean).join(' · ')
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

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { FactoryActivitySummary, RunUiStatusKey } from '@/api/client'
import { WeekPulse } from '@/components/SidebarSpend'
import { SummaryBar } from '@/components/homepage/RunFeed'
import { renderWithProviders } from './test-utils'

describe('factory activity summary UI', () => {
  it('renders activity headline totals from the uncapped summary', () => {
    render(<SummaryBar runs={[]} summary={activitySummaryFixture()} />)

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('110')).toBeInTheDocument()
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

function windowSummary(input: {
  label: string
  attemptCount: number
  running?: number
  awaitingApproval?: number
  cleanDone: number
  attention?: number
  trackedUsd: number
  missingUsage: number
  tokensOut?: number
  costPerCleanDoneUsd: number
  costPerCleanDoneLabel: string
}): FactoryActivitySummary['allTime'] {
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
      measured: input.attemptCount - input.missingUsage,
      pending: 0,
      missingPrice: 0,
      missingUsage: input.missingUsage,
      total: input.attemptCount,
      valueLabel: `$${input.trackedUsd.toFixed(2)}`,
      issueLabel: input.missingUsage === 0 ? '' : `${input.missingUsage} attempts missing usage`,
      hasGap: input.missingUsage > 0,
    },
    costPerCleanDoneUsd: input.costPerCleanDoneUsd,
    costPerCleanDoneLabel: input.costPerCleanDoneLabel,
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

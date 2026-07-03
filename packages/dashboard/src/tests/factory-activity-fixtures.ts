import type { FactoryActivitySummary, RunUiStatusKey } from '@/api/client'

interface ActivitySummaryFixtureInput {
  attemptCount?: number
  cleanDone?: number
  trackedUsd?: number
  missingUsage?: number
  missingPrice?: number
  costPerCleanDoneLabel?: string
  currentAttemptCount?: number
  currentCleanDone?: number
  currentTrackedUsd?: number
  currentMissingUsage?: number
  currentMissingPrice?: number
  currentCostPerCleanDoneLabel?: string
  previousAttemptCount?: number
  previousCleanDone?: number
  previousTrackedUsd?: number
  previousMissingUsage?: number
  previousMissingPrice?: number
  previousCostPerCleanDoneLabel?: string
  tokensOut?: number
  attention?: number
}

export function activitySummaryFixture(input: ActivitySummaryFixtureInput = {}): FactoryActivitySummary {
  const attemptCount = input.attemptCount ?? 1
  const cleanDone = input.cleanDone ?? 1
  const trackedUsd = input.trackedUsd ?? 2.5
  const missingUsage = input.missingUsage ?? 0
  const missingPrice = input.missingPrice ?? 0
  const costPerCleanDoneLabel = input.costPerCleanDoneLabel ?? '$2.50'
  return {
    generatedAt: '2026-07-01T12:00:00.000Z',
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount,
    },
    currentWindow: windowSummary({
      label: 'Last 7 days',
      attemptCount: input.currentAttemptCount ?? attemptCount,
      cleanDone: input.currentCleanDone ?? cleanDone,
      trackedUsd: input.currentTrackedUsd ?? trackedUsd,
      missingUsage: input.currentMissingUsage ?? missingUsage,
      missingPrice: input.currentMissingPrice ?? missingPrice,
      costPerCleanDoneLabel: input.currentCostPerCleanDoneLabel ?? costPerCleanDoneLabel,
      tokensOut: input.tokensOut,
    }),
    previousWindow: windowSummary({
      label: 'Previous 7 days',
      attemptCount: input.previousAttemptCount ?? 0,
      cleanDone: input.previousCleanDone ?? 0,
      trackedUsd: input.previousTrackedUsd ?? 0,
      missingUsage: input.previousMissingUsage ?? 0,
      missingPrice: input.previousMissingPrice ?? 0,
      costPerCleanDoneLabel: input.previousCostPerCleanDoneLabel ?? 'n/a',
    }),
    allTime: windowSummary({
      label: 'All attempts',
      attemptCount,
      cleanDone,
      trackedUsd,
      missingUsage,
      missingPrice,
      costPerCleanDoneLabel,
      startedAt: null,
      tokensOut: input.tokensOut,
      attention: input.attention ?? missingUsage + missingPrice,
    }),
  }
}

function windowSummary(input: {
  label: string
  attemptCount: number
  cleanDone: number
  trackedUsd: number
  missingUsage: number
  missingPrice: number
  costPerCleanDoneLabel: string
  startedAt?: string | null
  tokensOut?: number
  attention?: number
}): FactoryActivitySummary['allTime'] {
  const hasGap = input.missingUsage > 0 || input.missingPrice > 0
  return {
    label: input.label,
    startedAt: input.startedAt === undefined ? '2026-06-24T12:00:00.000Z' : input.startedAt,
    endedAt: '2026-07-01T12:00:00.000Z',
    attemptCount: input.attemptCount,
    statusCounts: { ...emptyStatusCounts(), done: input.cleanDone },
    cleanDone: input.cleanDone,
    attention: input.attention ?? input.missingUsage + input.missingPrice,
    stalledOrFailed: 0,
    tokensOut: input.tokensOut ?? 0,
    cost: {
      trackedUsd: input.trackedUsd,
      // Mirrors the SQL aggregate: a row counts as measured only when
      // cost_usd > 0. Rows with no cost split into pending, missing_price
      // (tokens but no rate), or missing_usage (no tokens, terminal).
      measured: Math.max(0, input.attemptCount - input.missingUsage - input.missingPrice),
      pending: 0,
      missingPrice: input.missingPrice,
      missingUsage: input.missingUsage,
      total: input.attemptCount,
      valueLabel: `$${input.trackedUsd.toFixed(2)}`,
      issueLabel: buildIssueLabel(input.missingUsage, input.missingPrice),
      hasGap,
    },
    costPerCleanDoneUsd: input.cleanDone === 0 ? null : input.trackedUsd / input.cleanDone,
    costPerCleanDoneLabel: input.costPerCleanDoneLabel,
  }
}

/**
 * Mirrors the server's `costIssueLabel` so dashboard fixtures stay
 * truthful when both gap kinds appear together. The contract (issue
 * #244 behavior contract #2) requires missing-usage and missing-price
 * to surface as distinct labels — never as a single ambiguous gap.
 */
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

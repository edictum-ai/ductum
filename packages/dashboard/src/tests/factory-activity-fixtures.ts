import type { FactoryActivitySummary, RunUiStatusKey } from '@/api/client'

interface ActivitySummaryFixtureInput {
  attemptCount?: number
  cleanDone?: number
  trackedUsd?: number
  missingUsage?: number
  costPerCleanDoneLabel?: string
  currentAttemptCount?: number
  currentCleanDone?: number
  currentTrackedUsd?: number
  currentMissingUsage?: number
  currentCostPerCleanDoneLabel?: string
  previousAttemptCount?: number
  previousCleanDone?: number
  previousTrackedUsd?: number
  previousMissingUsage?: number
  previousCostPerCleanDoneLabel?: string
  tokensOut?: number
  attention?: number
}

export function activitySummaryFixture(input: ActivitySummaryFixtureInput = {}): FactoryActivitySummary {
  const attemptCount = input.attemptCount ?? 1
  const cleanDone = input.cleanDone ?? 1
  const trackedUsd = input.trackedUsd ?? 2.5
  const missingUsage = input.missingUsage ?? 0
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
      costPerCleanDoneLabel: input.currentCostPerCleanDoneLabel ?? costPerCleanDoneLabel,
      tokensOut: input.tokensOut,
    }),
    previousWindow: windowSummary({
      label: 'Previous 7 days',
      attemptCount: input.previousAttemptCount ?? 0,
      cleanDone: input.previousCleanDone ?? 0,
      trackedUsd: input.previousTrackedUsd ?? 0,
      missingUsage: input.previousMissingUsage ?? 0,
      costPerCleanDoneLabel: input.previousCostPerCleanDoneLabel ?? 'n/a',
    }),
    allTime: windowSummary({
      label: 'All attempts',
      attemptCount,
      cleanDone,
      trackedUsd,
      missingUsage,
      costPerCleanDoneLabel,
      startedAt: null,
      tokensOut: input.tokensOut,
      attention: input.attention ?? missingUsage,
    }),
  }
}

function windowSummary(input: {
  label: string
  attemptCount: number
  cleanDone: number
  trackedUsd: number
  missingUsage: number
  costPerCleanDoneLabel: string
  startedAt?: string | null
  tokensOut?: number
  attention?: number
}): FactoryActivitySummary['allTime'] {
  return {
    label: input.label,
    startedAt: input.startedAt === undefined ? '2026-06-24T12:00:00.000Z' : input.startedAt,
    endedAt: '2026-07-01T12:00:00.000Z',
    attemptCount: input.attemptCount,
    statusCounts: { ...emptyStatusCounts(), done: input.cleanDone },
    cleanDone: input.cleanDone,
    attention: input.attention ?? input.missingUsage,
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
    costPerCleanDoneUsd: input.cleanDone === 0 ? null : input.trackedUsd / input.cleanDone,
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

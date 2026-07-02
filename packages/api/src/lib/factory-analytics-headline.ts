import type { DisplayStatus } from '@ductum/core'

import type { ApiContext } from './deps.js'
import type { CleanDoneIndex } from './factory-analytics-clean.js'
import type { AnalyticsHeadline, AnalyticsRangeWindow } from './factory-analytics-types.js'
import { readWindowRows, type WindowAggregateRow } from './factory-analytics-sql.js'
import { buildCostSummary, emptyCostInput, formatCost, roundCents } from './factory-analytics-cost.js'

const EMPTY_STATUS_COUNTS: Record<DisplayStatus, number> = {
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

export function buildHeadline(
  context: ApiContext,
  window: AnalyticsRangeWindow,
  cleanDoneIndex: CleanDoneIndex,
): AnalyticsHeadline {
  const rows = readWindowRows(context, window.from, window.to)
  const statusCounts: Record<DisplayStatus, number> = { ...EMPTY_STATUS_COUNTS }
  const costInput = emptyCostInput()

  let attemptCount = 0
  let attention = 0
  let stalledOrFailed = 0
  let tokensOut = 0
  let reviewPasses = 0
  let reviewFailures = 0
  let verificationFailures = 0

  for (const row of rows) {
    const count = row.attempt_count
    attemptCount += count
    statusCounts[row.status] += count
    if (isAttention(row.status)) attention += count
    if (row.status === 'failed' || row.status === 'stalled') stalledOrFailed += count
    tokensOut += row.tokens_out
    reviewPasses += row.review_passes
    reviewFailures += row.review_failures
    verificationFailures += row.verification_failures
    addCostRow(costInput, row)
  }

  costInput.total = attemptCount
  const cost = buildCostSummary(costInput)
  const cleanDone = cleanDoneIndex.total
  const cleanDoneRatePct = attemptCount === 0 ? null : cleanDone / attemptCount
  const costPerCleanDoneUsd = cleanDone > 0 ? roundCents(cost.trackedUsd / cleanDone) : null

  return {
    attemptCount,
    statusCounts,
    cleanDone,
    cleanDoneRateLabel: attemptCount === 0 ? '0/0' : `${cleanDone}/${attemptCount}`,
    cleanDoneRatePct,
    attention,
    stalledOrFailed,
    tokensOut,
    cost,
    costPerCleanDoneUsd,
    costPerCleanDoneLabel: costPerCleanDoneUsd == null ? 'n/a' : formatCost(costPerCleanDoneUsd),
    reviewPasses,
    reviewFailures,
    verificationFailures,
  }
}

export function buildCoverageLabel(window: AnalyticsRangeWindow, headline: AnalyticsHeadline): string {
  const rangePart = window.kind === 'all'
    ? 'all attempts'
    : `${window.label.toLowerCase()} (UTC)`
  const gapPart = headline.cost.hasGap
    ? ` · ${analyticsCoverageIssueLabel(headline.cost)}`
    : ''
  return `SQL COUNT(*) over ${rangePart}${gapPart}`
}

function analyticsCoverageIssueLabel(cost: AnalyticsHeadline['cost']): string {
  return [
    cost.missingUsage > 0 ? countLabel(cost.missingUsage, 'unmeasured attempt') : null,
    cost.missingPrice > 0 ? countLabel(cost.missingPrice, 'price-missing attempt') : null,
    cost.pending > 0 ? countLabel(cost.pending, 'pending attempt') : null,
  ].filter(Boolean).join(' · ')
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function addCostRow(summary: ReturnType<typeof emptyCostInput>, row: WindowAggregateRow) {
  summary.trackedUsd += row.tracked_usd
  summary.measured += row.measured
  summary.pending += row.pending
  summary.missingPrice += row.missing_price
  summary.missingUsage += row.missing_usage
}

function isAttention(status: DisplayStatus): boolean {
  return status === 'failed' || status === 'stalled' || status === 'frozen' || status === 'quarantined'
}

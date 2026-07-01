import type { DisplayStatus } from '@ductum/core'

import type { ApiContext } from './deps.js'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export interface FactoryActivityCostSummary {
  trackedUsd: number
  measured: number
  pending: number
  missingPrice: number
  missingUsage: number
  total: number
  valueLabel: string
  issueLabel: string
  hasGap: boolean
}

export interface FactoryActivityWindowSummary {
  label: string
  startedAt: string | null
  endedAt: string
  attemptCount: number
  statusCounts: Record<DisplayStatus, number>
  cleanDone: number
  attention: number
  stalledOrFailed: number
  tokensOut: number
  cost: FactoryActivityCostSummary
  costPerCleanDoneUsd: number | null
  costPerCleanDoneLabel: string
}

export interface FactoryActivitySummary {
  generatedAt: string
  source: {
    kind: 'all_runs'
    label: string
    capped: false
    attemptCount: number
  }
  currentWindow: FactoryActivityWindowSummary
  previousWindow: FactoryActivityWindowSummary
  allTime: FactoryActivityWindowSummary
}

export function buildFactoryActivitySummary(context: ApiContext): FactoryActivitySummary {
  const now = context.now()
  const currentStartedAt = new Date(now.getTime() - WEEK_MS)
  const previousStartedAt = new Date(now.getTime() - WEEK_MS * 2)
  const allTime = summarizeWindow(context, 'All attempts', null, now)

  return {
    generatedAt: now.toISOString(),
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: allTime.attemptCount,
    },
    currentWindow: summarizeWindow(context, 'Last 7 days', currentStartedAt, now),
    previousWindow: summarizeWindow(context, 'Previous 7 days', previousStartedAt, currentStartedAt),
    allTime,
  }
}

function summarizeWindow(
  context: ApiContext,
  label: string,
  startedAt: Date | null,
  endedAt: Date,
): FactoryActivityWindowSummary {
  const rows = readWindowRows(context, startedAt, endedAt)
  const statusCounts = emptyStatusCounts()
  const cost = emptyCostSummary()

  let attemptCount = 0
  let cleanDone = 0
  let attention = 0
  let stalledOrFailed = 0
  let tokensOut = 0

  for (const row of rows) {
    const status = row.status
    const count = row.attempt_count
    attemptCount += count
    statusCounts[status] += count
    if (status === 'done') cleanDone += count
    if (isNeedsAttentionStatus(status)) attention += count
    if (status === 'failed' || status === 'stalled') stalledOrFailed += count
    tokensOut += row.tokens_out
    addCostTotals(cost, row)
  }

  finalizeCost(cost)
  const costPerCleanDoneUsd = cleanDone > 0 ? cost.trackedUsd / cleanDone : null
  return {
    label,
    startedAt: startedAt?.toISOString() ?? null,
    endedAt: endedAt.toISOString(),
    attemptCount,
    statusCounts,
    cleanDone,
    attention,
    stalledOrFailed,
    tokensOut,
    cost,
    costPerCleanDoneUsd,
    costPerCleanDoneLabel: costPerCleanDoneUsd == null ? 'n/a' : formatCost(costPerCleanDoneUsd),
  }
}

interface WindowSummaryRow {
  status: DisplayStatus
  attempt_count: number
  tokens_out: number
  tracked_usd: number
  measured: number
  pending: number
  missing_price: number
  missing_usage: number
}

function readWindowRows(context: ApiContext, startedAt: Date | null, endedAt: Date): WindowSummaryRow[] {
  const conditions = ['datetime(created_at) < datetime(?)']
  const params: unknown[] = [endedAt.toISOString()]
  if (startedAt != null) {
    conditions.unshift('datetime(created_at) >= datetime(?)')
    params.unshift(startedAt.toISOString())
  }

  return context.db
    .prepare(
      `
        SELECT
          ${statusCaseSql()} AS status,
          COUNT(*) AS attempt_count,
          COALESCE(SUM(tokens_out), 0) AS tokens_out,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN cost_usd ELSE 0 END), 0) AS tracked_usd,
          COALESCE(SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END), 0) AS measured,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND (tokens_in > 0 OR tokens_out > 0) THEN 1 ELSE 0 END), 0) AS missing_price,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND terminal_state IS NULL AND stage != 'done' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN cost_usd <= 0 AND NOT (tokens_in > 0 OR tokens_out > 0) AND NOT (terminal_state IS NULL AND stage != 'done') THEN 1 ELSE 0 END), 0) AS missing_usage
        FROM runs
        WHERE ${conditions.join(' AND ')}
        GROUP BY status
      `,
    )
    .all(...params) as WindowSummaryRow[]
}

function statusCaseSql(): string {
  return `
    CASE
      WHEN terminal_state = 'quarantined' THEN 'quarantined'
      WHEN terminal_state = 'failed' THEN 'failed'
      WHEN terminal_state = 'stalled' THEN 'stalled'
      WHEN terminal_state = 'frozen' THEN 'frozen'
      WHEN terminal_state = 'paused' THEN 'paused'
      WHEN terminal_state = 'cancelled' THEN 'cancelled'
      WHEN stage = 'done' THEN 'done'
      WHEN stage = 'ship' AND pending_approval = 1 THEN 'awaiting_approval'
      ELSE 'running'
    END
  `
}

function emptyStatusCounts(): Record<DisplayStatus, number> {
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

function emptyCostSummary(): FactoryActivityCostSummary {
  return {
    trackedUsd: 0,
    measured: 0,
    pending: 0,
    missingPrice: 0,
    missingUsage: 0,
    total: 0,
    valueLabel: formatCost(0),
    issueLabel: '',
    hasGap: false,
  }
}

function addCostTotals(summary: FactoryActivityCostSummary, row: WindowSummaryRow) {
  summary.total += row.attempt_count
  summary.trackedUsd += row.tracked_usd
  summary.measured += row.measured
  summary.pending += row.pending
  summary.missingPrice += row.missing_price
  summary.missingUsage += row.missing_usage
}

function finalizeCost(summary: FactoryActivityCostSummary) {
  summary.hasGap = summary.missingUsage > 0 || summary.missingPrice > 0
  summary.valueLabel = costValueLabel(summary)
  summary.issueLabel = costIssueLabel(summary)
}

function costValueLabel(summary: FactoryActivityCostSummary): string {
  if (summary.trackedUsd > 0) return formatCost(summary.trackedUsd)
  if (summary.pending > 0) return 'pending'
  if (summary.hasGap) return 'unknown'
  return formatCost(0)
}

function costIssueLabel(summary: FactoryActivityCostSummary): string {
  return [
    summary.missingUsage > 0 ? missingCostLabel(summary.missingUsage, 'usage') : null,
    summary.missingPrice > 0 ? missingCostLabel(summary.missingPrice, 'price') : null,
    summary.pending > 0 ? countLabel(summary.pending, 'pending') : null,
  ].filter(Boolean).join(' · ')
}

function isNeedsAttentionStatus(status: DisplayStatus): boolean {
  return status === 'failed' || status === 'stalled' || status === 'frozen' || status === 'quarantined'
}

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function missingCostLabel(count: number, kind: 'usage' | 'price'): string {
  return `${count} attempt${count === 1 ? '' : 's'} missing ${kind}`
}

function formatCost(usd: number): string {
  if (usd < 0.01 && usd > 0) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

import type { DisplayStatus, Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { enrichRuns, type EnrichedRun } from './enriched-runs.js'
import type { RunUiContract } from './ui-contract.js'

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

type CostState = RunUiContract['cost']['state']

export function buildFactoryActivitySummary(context: ApiContext): FactoryActivitySummary {
  const now = context.now()
  const currentStartedAt = new Date(now.getTime() - WEEK_MS)
  const previousStartedAt = new Date(now.getTime() - WEEK_MS * 2)
  const runs = enrichRuns(context, context.repos.runs.listAll({ limit: null }))
  const currentRuns = runs.filter((run) => createdAtMs(run) >= currentStartedAt.getTime())
  const previousRuns = runs.filter((run) => {
    const createdAt = createdAtMs(run)
    return createdAt >= previousStartedAt.getTime() && createdAt < currentStartedAt.getTime()
  })

  return {
    generatedAt: now.toISOString(),
    source: {
      kind: 'all_runs',
      label: 'All attempts in the factory database',
      capped: false,
      attemptCount: runs.length,
    },
    currentWindow: summarizeWindow('Last 7 days', currentStartedAt, now, currentRuns),
    previousWindow: summarizeWindow('Previous 7 days', previousStartedAt, currentStartedAt, previousRuns),
    allTime: summarizeWindow('All attempts', null, now, runs),
  }
}

function summarizeWindow(
  label: string,
  startedAt: Date | null,
  endedAt: Date,
  runs: EnrichedRun[],
): FactoryActivityWindowSummary {
  const statusCounts = emptyStatusCounts()
  let cleanDone = 0
  let attention = 0
  let stalledOrFailed = 0
  let tokensOut = 0
  const cost = emptyCostSummary()

  for (const run of runs) {
    const status = displayStatus(run)
    statusCounts[status] += 1
    tokensOut += run.tokensOut ?? 0
    if (status === 'done' && !hasExecutionIntegrityIssue(run)) cleanDone += 1
    if (hasExecutionIntegrityIssue(run) || run.ui.status.needsAttention) attention += 1
    if (status === 'failed' || status === 'stalled') stalledOrFailed += 1
    addCost(cost, run.ui.cost)
  }

  finalizeCost(cost)
  const costPerCleanDoneUsd = cleanDone > 0 ? cost.trackedUsd / cleanDone : null
  return {
    label,
    startedAt: startedAt?.toISOString() ?? null,
    endedAt: endedAt.toISOString(),
    attemptCount: runs.length,
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

function addCost(summary: FactoryActivityCostSummary, cost: RunUiContract['cost']) {
  summary.total += 1
  summary.trackedUsd += cost.usd
  if (cost.state === 'measured') summary.measured += 1
  else if (cost.state === 'pending') summary.pending += 1
  else if (cost.state === 'unpriced') summary.missingPrice += 1
  else summary.missingUsage += 1
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

function displayStatus(run: EnrichedRun): DisplayStatus {
  return run.ui.status.key
}

function hasExecutionIntegrityIssue(run: EnrichedRun): boolean {
  return run.executionMode === 'inconsistent' || run.executionIssues.length > 0
}

function createdAtMs(run: Pick<Run, 'createdAt'>): number {
  return Date.parse(run.createdAt)
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

import { Link } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { Mono, Num, tokens } from '@/components/signal'
import { CLEAN_DONE_TITLE } from '@/lib/clean-done'
import { costCoverageIssues, summarizeCostCoverage } from '@/lib/cost-coverage'
import { formatCost } from '@/lib/utils'
import { runDisplayStatus } from '@/lib/run-presentation'
import { hasExecutionIntegrityIssue } from '@/lib/execution-integrity'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function WeekPulse({ runs }: { runs?: EnrichedRun[] }) {
  const metrics = weekSpendMetrics(runs ?? [])
  const dollars = Math.floor(metrics.weekSpent)
  const cents = Math.round((metrics.weekSpent - dollars) * 100).toString().padStart(2, '0')
  return (
    <Link
      to="/activity"
      aria-label="Open Factory Activity"
      style={{
        display: 'block',
        padding: '14px 18px 18px',
        borderTop: `1px solid ${tokens.hair}`,
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <div
        style={{
          fontFamily: tokens.mono,
          fontSize: 9,
          letterSpacing: 1.6,
          textTransform: 'uppercase',
          color: tokens.dim,
        }}
      >
        Tracked spend this week
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 6 }}>
        <Num size={22} color={tokens.strong}>${dollars}</Num>
        <Mono size={12} color={tokens.dim}>.{cents}</Mono>
      </div>
      <div style={{ marginTop: 8, height: 3, background: tokens.hair, borderRadius: 2 }} />
      <Mono size={10} color={tokens.dim} style={{ marginTop: 6, display: 'block', lineHeight: 1.35 }} title={CLEAN_DONE_TITLE}>
        {[
          `${metrics.costPerCleanDoneLabel}/clean done`,
          metrics.weekDeltaLabel,
          metrics.costIssueLabel,
        ].filter(Boolean).join(' · ')}
      </Mono>
    </Link>
  )
}

function weekSpendMetrics(runs: EnrichedRun[]) {
  const now = Date.now()
  const currentCutoff = now - WEEK_MS
  const previousCutoff = now - 2 * WEEK_MS
  const current = runs.filter((run) => Date.parse(run.createdAt) >= currentCutoff)
  const previous = runs.filter((run) => {
    const createdAt = Date.parse(run.createdAt)
    return createdAt >= previousCutoff && createdAt < currentCutoff
  })
  const currentCoverage = summarizeCostCoverage(current)
  const previousCoverage = summarizeCostCoverage(previous)
  const weekSpent = currentCoverage.trackedUsd
  const previousSpent = previousCoverage.trackedUsd
  // Failed and integrity-flagged spend stays in the numerator so wasted work raises cost per clean outcome.
  const cleanDone = current.filter((run) => runDisplayStatus(run) === 'done' && !hasExecutionIntegrityIssue(run)).length
  return {
    weekSpent,
    costPerCleanDoneLabel: cleanDone === 0 ? 'n/a' : formatCost(weekSpent / cleanDone),
    weekDeltaLabel: weekDelta(weekSpent, previousSpent),
    costIssueLabel: costCoverageIssues(currentCoverage),
  }
}

function weekDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'no prior-week spend' : `+${formatCost(current)} vs prior week`
  const diff = current - previous
  if (diff === 0) return 'flat vs prior week'
  return `${diff > 0 ? '+' : '-'}${formatCost(Math.abs(diff))} vs prior week`
}

import { Link } from 'react-router-dom'

import type { FactoryActivitySummary } from '@/api/client'
import { Mono, Num, tokens } from '@/components/signal'
import { CLEAN_DONE_TITLE } from '@/lib/clean-done'
import { formatCost } from '@/lib/utils'

export function WeekPulse({ summary }: { summary?: FactoryActivitySummary }) {
  const metrics = summary == null ? null : summaryWeekSpendMetrics(summary)
  const dollars = metrics == null ? '--' : Math.floor(metrics.weekSpent).toString()
  const cents = metrics == null
    ? ''
    : `.${Math.round((metrics.weekSpent - Math.floor(metrics.weekSpent)) * 100).toString().padStart(2, '0')}`
  const detail = metrics == null
    ? 'Factory activity summary loading'
    : [
        `${metrics.costPerCleanDoneLabel}/clean done`,
        metrics.weekDeltaLabel,
        metrics.costIssueLabel,
      ].filter(Boolean).join(' · ')
  const title = metrics == null
    ? 'Factory spend waits for the uncapped activity summary.'
    : `${CLEAN_DONE_TITLE} ${metrics.sourceLabel}`
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
        {cents && <Mono size={12} color={tokens.dim}>{cents}</Mono>}
      </div>
      <div style={{ marginTop: 8, height: 3, background: tokens.hair, borderRadius: 2 }} />
      <Mono size={10} color={tokens.dim} style={{ marginTop: 6, display: 'block', lineHeight: 1.35 }} title={title}>
        {detail}
      </Mono>
    </Link>
  )
}

function summaryWeekSpendMetrics(summary: FactoryActivitySummary) {
  const current = summary.currentWindow
  const previous = summary.previousWindow
  return {
    weekSpent: current.cost.trackedUsd,
    costPerCleanDoneLabel: current.costPerCleanDoneLabel,
    weekDeltaLabel: weekDelta(current.cost.trackedUsd, previous.cost.trackedUsd),
    costIssueLabel: current.cost.issueLabel,
    sourceLabel: summary.source.label,
  }
}

function weekDelta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'no prior-week spend' : `+${formatCost(current)} vs prior week`
  const diff = current - previous
  if (diff === 0) return 'flat vs prior week'
  return `${diff > 0 ? '+' : '-'}${formatCost(Math.abs(diff))} vs prior week`
}

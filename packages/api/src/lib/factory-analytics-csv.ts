import { redactPublicText } from '@ductum/core'

import type { FactoryAnalyticsReport } from './factory-analytics-types.js'

/**
 * CSV projection of the analytics report. The dashboard uses JSON
 * normally; this CSV form powers the "Export" button when an operator
 * wants a spreadsheet or to share a snapshot.
 *
 * We render one row per attempt-bucket so the export preserves the
 * trend series, plus per-agent and per-model summary sections.
 */
export function csvProjection(report: FactoryAnalyticsReport): {
  lines: string[]
  contentType: string
} {
  const lines: string[] = []
  lines.push(`# ductum factory analytics report`)
  lines.push(`# range,${report.range.label}`)
  lines.push(`# from,${report.range.from ?? ''}`)
  lines.push(`# to,${report.range.to}`)
  lines.push(`# generated_at,${report.generatedAt}`)
  lines.push(`# coverage,${report.source.coverageLabel}`)
  lines.push('')
  lines.push('section,key,label,attempts,clean_done,spend_usd,stalls,failures,missing_usage,missing_price')
  for (const bucket of report.trends.buckets) {
    lines.push([
      'trend',
      bucket.bucketLabel,
      bucket.bucketLabel,
      bucket.attempts,
      bucket.cleanDone,
      bucket.spendUsd.toFixed(2),
      bucket.stalls,
      bucket.failures,
      bucket.missingUsage,
      bucket.missingPrice,
    ].join(','))
  }
  for (const row of report.perAgent) {
    lines.push([
      'agent',
      csvCell(row.key),
      csvCell(row.label),
      row.attemptCount,
      row.cleanDone,
      row.costTrackedUsd.toFixed(2),
      '',
      '',
      row.missingUsage,
      row.missingPrice,
    ].join(','))
  }
  for (const row of report.perModel) {
    lines.push([
      'model',
      csvCell(row.key),
      csvCell(row.label),
      row.attemptCount,
      row.cleanDone,
      row.costTrackedUsd.toFixed(2),
      '',
      '',
      row.missingUsage,
      row.missingPrice,
    ].join(','))
  }
  return { lines, contentType: 'text/csv; charset=utf-8' }
}

function csvCell(value: string): string {
  const redacted = redactPublicText(value)
  const neutralized = /^[=+\-@\t\r]/.test(redacted) ? `'${redacted}` : redacted
  if (neutralized.includes(',') || neutralized.includes('"') || neutralized.includes('\n')) {
    return `"${neutralized.replace(/"/g, '""')}"`
  }
  return neutralized
}

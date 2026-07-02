import type { ApiContext } from './deps.js'
import {
  ANALYTICS_DEFAULT_RANGE,
  ANALYTICS_RANGE_LABELS,
  type AnalyticsBucketKind,
  type AnalyticsRangeKind,
  type AnalyticsRangeWindow,
} from './factory-analytics-types.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Parse the dashboard date-range selector into an explicit window. The
 * `kind` is the source of truth; `from`/`to` are accepted as ISO strings
 * for `custom` so dashboards can deep-link an arbitrary range.
 *
 * Defaults are explicit (issue #218 safety): callers MUST pass `range=`
 * to override the 7-day default. We never guess.
 */
export function parseAnalyticsRange(
  now: Date,
  input: { range?: string; from?: string; to?: string },
): AnalyticsRangeWindow {
  const kind = coerceRangeKind(input.range) ?? ANALYTICS_DEFAULT_RANGE
  const to = parseTo(input.to, now)
  if (kind === 'all') {
    return {
      kind,
      label: ANALYTICS_RANGE_LABELS[kind],
      from: null,
      to: to.toISOString(),
      days: null,
      bucket: chooseBucketKind(null),
    }
  }
  if (kind === 'custom') {
    const from = parseFrom(input.from, to)
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS))
    return {
      kind,
      label: ANALYTICS_RANGE_LABELS[kind],
      from: from.toISOString(),
      to: to.toISOString(),
      days,
      bucket: chooseBucketKind(days),
    }
  }
  const days = rangeDays(kind)
  const from = new Date(to.getTime() - days * DAY_MS)
  return {
    kind,
    label: ANALYTICS_RANGE_LABELS[kind],
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    bucket: chooseBucketKind(days),
  }
}

/**
 * Compute the comparison window of equal length immediately preceding
 * `window`. Returns null for `all` (no peer) and for `custom` ranges
 * shorter than a day.
 */
export function previousAnalyticsWindow(window: AnalyticsRangeWindow): AnalyticsRangeWindow | null {
  if (window.kind === 'all' || window.from == null) return null
  const to = new Date(window.from)
  const days = window.days ?? Math.max(1, Math.round((Date.parse(window.to) - Date.parse(window.from)) / DAY_MS))
  const from = new Date(to.getTime() - days * DAY_MS)
  return {
    kind: window.kind,
    label: `Previous ${days} day${days === 1 ? '' : 's'}`,
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    bucket: window.bucket,
  }
}

function coerceRangeKind(value: string | undefined): AnalyticsRangeKind | null {
  if (value == null || value === '') return null
  switch (value) {
    case '7d':
    case '30d':
    case '90d':
    case 'all':
    case 'custom':
      return value
    default:
      return null
  }
}

function parseTo(value: string | undefined, now: Date): Date {
  if (value == null || value === '') return now
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return now
  if (parsed.getTime() > now.getTime()) return now
  return parsed
}

function parseFrom(value: string | undefined, to: Date): Date {
  if (value == null || value === '') {
    return new Date(to.getTime() - 7 * DAY_MS)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return new Date(to.getTime() - 7 * DAY_MS)
  }
  if (parsed.getTime() >= to.getTime()) {
    return new Date(to.getTime() - DAY_MS)
  }
  return parsed
}

function rangeDays(kind: Extract<AnalyticsRangeKind, '7d' | '30d' | '90d'>): number {
  switch (kind) {
    case '7d': return 7
    case '30d': return 30
    case '90d': return 90
  }
}

/** Choose trend bucket granularity from window length so the chart stays legible. */
export function chooseBucketKind(days: number | null): AnalyticsBucketKind {
  if (days == null) return 'month'
  if (days <= 30) return 'day'
  if (days <= 90) return 'week'
  return 'month'
}

/**
 * Bucket boundary expressions for SQLite. We return the SQL fragment and
 * the JS formatter separately so the builder can group rows by bucket
 * and also synthesize zero-fill rows client-free.
 */
export function bucketSqlExpressions(kind: AnalyticsBucketKind): {
  group: string
  formatLabel: (key: string) => string
  bucketStart: (when: Date) => Date
  bucketEnd: (when: Date) => Date
} {
  switch (kind) {
    case 'day':
      return {
        group: `strftime('%Y-%m-%d', created_at)`,
        formatLabel: (key) => key,
        bucketStart: startOfDay,
        bucketEnd: endOfDay,
      }
    case 'week':
      return {
        group: `strftime('%Y-%m-%d', date(created_at, 'weekday 0', '-6 days'))`,
        formatLabel: (key) => `wk of ${key}`,
        bucketStart: startOfWeek,
        bucketEnd: endOfWeek,
      }
    case 'month':
      return {
        group: `strftime('%Y-%m', created_at)`,
        formatLabel: (key) => `${key}`,
        bucketStart: startOfMonth,
        bucketEnd: endOfMonth,
      }
  }
}

function startOfDay(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()))
}

function endOfDay(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()) + DAY_MS)
}

function startOfWeek(when: Date): Date {
  const day = when.getUTCDay()
  const start = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()))
  start.setUTCDate(start.getUTCDate() + (day === 0 ? -6 : 1 - day))
  return start
}

function endOfWeek(when: Date): Date {
  return new Date(startOfWeek(when).getTime() + 7 * DAY_MS)
}

function startOfMonth(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1))
}

function endOfMonth(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 1))
}

/** Iterate bucket boundaries (inclusive-start, exclusive-end) covering [from, to). */
export function iterateBuckets(
  from: Date,
  to: Date,
  kind: AnalyticsBucketKind,
): Array<{ start: Date; end: Date }> {
  const expressions = bucketSqlExpressions(kind)
  const out: Array<{ start: Date; end: Date }> = []
  const limit = kind === 'month' ? 36 : kind === 'week' ? 53 : 366
  let cursor = expressions.bucketStart(from)
  let guard = 0
  while (cursor.getTime() < to.getTime() && guard < limit) {
    const end = expressions.bucketEnd(cursor)
    out.push({ start: cursor, end })
    cursor = end
    guard += 1
  }
  return out
}

export const ANALYTICS_DAY_MS = DAY_MS

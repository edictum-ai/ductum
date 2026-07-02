import type { Hono } from 'hono'

import { buildFactoryAnalyticsReport } from '../lib/factory-analytics.js'
import { csvProjection } from '../lib/factory-analytics-csv.js'
import type { ApiContext } from '../lib/deps.js'
import { optionalString } from '../lib/http.js'
import { publicOutput } from '../lib/public-output.js'

/**
 * Analytics routes for issue #218. The dashboard date-range selector
 * honors `range=7d|30d|90d|all|custom`. Custom ranges additionally
 * accept `from`/`to` ISO timestamps; we clamp `to` to "now" so the
 * dashboard cannot ask for future spend.
 */
export function registerFactoryAnalyticsRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory/analytics', (c) => {
    const report = buildFactoryAnalyticsReport(context, {
      range: optionalString(c.req.query('range'), 'range'),
      from: optionalString(c.req.query('from'), 'from'),
      to: optionalString(c.req.query('to'), 'to'),
      missingUsageFilter: parseMissingUsageFilter(c.req.query('missingUsage')),
    })
    return c.json(publicOutput(report))
  })

  // Shareable / exportable factory report. JSON today; a CSV projection
  // powers the dashboard Export button.
  app.get('/api/factory/analytics/report', (c) => {
    const report = buildFactoryAnalyticsReport(context, {
      range: optionalString(c.req.query('range'), 'range'),
      from: optionalString(c.req.query('from'), 'from'),
      to: optionalString(c.req.query('to'), 'to'),
      missingUsageFilter: parseMissingUsageFilter(c.req.query('missingUsage')),
    })
    if (c.req.query('format') === 'csv') {
      const { lines, contentType } = csvProjection(report)
      return new Response(lines.join('\n'), {
        headers: {
          'content-type': contentType,
          'content-disposition': `attachment; filename="ductum-analytics-${report.range.kind}.csv"`,
        },
      })
    }
    return c.json(publicOutput({
      schemaVersion: 1,
      kind: 'ductum.factory_analytics_report.v1',
      generatedAt: report.generatedAt,
      range: report.range,
      report,
    }))
  })
}

function parseMissingUsageFilter(
  value: string | undefined,
): 'usage_missing' | 'price_missing' | 'any_gap' {
  if (value === 'usage_missing' || value === 'price_missing') return value
  return 'any_gap'
}

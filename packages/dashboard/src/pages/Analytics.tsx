import { BarChart3, Download, FileJson } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, type AnalyticsMissingUsageFilterKind, type AnalyticsRangeKind } from '@/api/client'
import { useFactoryAnalyticsReport } from '@/api/hooks'
import { AnalyticsBreakdownTable } from '@/components/analytics/AnalyticsBreakdownTable'
import { AnalyticsBudgetPanel } from '@/components/analytics/AnalyticsBudgetPanel'
import { AnalyticsHeadline } from '@/components/analytics/AnalyticsHeadline'
import { AnalyticsMissingUsagePanel } from '@/components/analytics/AnalyticsMissingUsagePanel'
import { AnalyticsRangeSelector } from '@/components/analytics/AnalyticsRangeSelector'
import { AnalyticsTrendChart } from '@/components/analytics/AnalyticsTrendChart'
import { MetricPill, Mono, Page, PageHeader, tokens } from '@/components/signal'

const RANGE_VALUES = new Set<AnalyticsRangeKind>(['7d', '30d', '90d', 'all'])
const MISSING_VALUES = new Set<AnalyticsMissingUsageFilterKind>(['any_gap', 'usage_missing', 'price_missing'])

export function Analytics() {
  const [params, setParams] = useSearchParams()
  const range = readRange(params.get('range'))
  const missingUsage = readMissingUsage(params.get('missingUsage'))
  const query = useMemo(() => ({ range, missingUsage }), [range, missingUsage])
  const { data: report, isLoading, error } = useFactoryAnalyticsReport(query)
  const csvUrl = api.getFactoryAnalyticsReportUrl({ range, missingUsage, format: 'csv' })
  const jsonUrl = api.getFactoryAnalyticsReportUrl({ range, missingUsage, format: 'json' })

  function setRange(next: AnalyticsRangeKind) {
    updateParams({ range: next, missingUsage })
  }

  function setMissingUsage(next: AnalyticsMissingUsageFilterKind) {
    updateParams({ range, missingUsage: next })
  }

  function updateParams(next: { range: AnalyticsRangeKind; missingUsage: AnalyticsMissingUsageFilterKind }) {
    setParams((current) => {
      const updated = new URLSearchParams(current)
      updated.set('range', next.range)
      updated.set('missingUsage', next.missingUsage)
      return updated
    }, { replace: true })
  }

  return (
    <Page maxWidth={1360}>
      <PageHeader
        eyebrow="Analytics"
        title="Factory Analytics"
        icon={<BarChart3 className="h-4 w-4" />}
        subtitle={report?.source.coverageLabel ?? 'Server-authoritative factory metrics.'}
        actions={(
          <>
            <ReportLink href={csvUrl} icon={<Download size={14} />} label="CSV" />
            <ReportLink href={jsonUrl} icon={<FileJson size={14} />} label="JSON" />
          </>
        )}
        metrics={report && (
          <>
            <MetricPill label="window" value={report.range.label} title={rangeTitle(report.range.from, report.range.to)} />
            <MetricPill label="attempts" value={report.headline.attemptCount} />
            <MetricPill label="known spend" value={`$${report.headline.cost.trackedUsd.toFixed(2)}`} tone={report.headline.cost.trackedUsd > 0 ? 'accent' : 'default'} />
            <MetricPill label="usage missing" value={report.headline.cost.missingUsage} tone={report.headline.cost.missingUsage > 0 ? 'warn' : 'default'} />
            <MetricPill label="price missing" value={report.headline.cost.missingPrice} tone={report.headline.cost.missingPrice > 0 ? 'info' : 'default'} />
          </>
        )}
      />

      <div style={{ display: 'grid', gap: 18 }}>
        <Panel>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <AnalyticsRangeSelector value={range} onChange={setRange} windowLabel={report?.range.label} />
            {report && <Mono size={11} color={tokens.dim}>{rangeTitle(report.range.from, report.range.to)}</Mono>}
          </div>
        </Panel>

        {isLoading && <LoadingBlock />}
        {error && <ErrorBlock message={String(error)} />}

        {report && (
          <>
            <Panel>
              <AnalyticsHeadline headline={report.headline} previous={report.previousHeadline} window_={report.range} />
            </Panel>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
              <Panel><AnalyticsTrendChart buckets={report.trends.buckets} metric="spendUsd" /></Panel>
              <Panel><AnalyticsTrendChart buckets={report.trends.buckets} metric="cleanDoneRate" /></Panel>
              <Panel><AnalyticsTrendChart buckets={report.trends.buckets} metric="stalls" /></Panel>
              <Panel><AnalyticsTrendChart buckets={report.trends.buckets} metric="missingUsage" /></Panel>
            </div>

            <Panel>
              <AnalyticsBudgetPanel budget={report.budget} />
            </Panel>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
              <Panel>
                <TableTitle title="Per-agent outcomes" meta={report.range.label} />
                <AnalyticsBreakdownTable rows={report.perAgent} scope="agent" emptyLabel="No agent rows in this window." />
              </Panel>
              <Panel>
                <TableTitle title="Per-model outcomes" meta={report.range.label} />
                <AnalyticsBreakdownTable rows={report.perModel} scope="model" emptyLabel="No model rows in this window." />
              </Panel>
            </div>

            <Panel>
              <AnalyticsMissingUsagePanel filter={report.missingUsage} onChange={setMissingUsage} windowLabel={report.range.label} />
            </Panel>
          </>
        )}
      </div>
    </Page>
  )
}

function readRange(value: string | null): AnalyticsRangeKind {
  return value != null && RANGE_VALUES.has(value as AnalyticsRangeKind) ? value as AnalyticsRangeKind : '7d'
}

function readMissingUsage(value: string | null): AnalyticsMissingUsageFilterKind {
  return value != null && MISSING_VALUES.has(value as AnalyticsMissingUsageFilterKind)
    ? value as AnalyticsMissingUsageFilterKind
    : 'any_gap'
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section style={{ border: `1px solid ${tokens.hair}`, borderRadius: 8, background: tokens.raised, padding: 16 }}>
      {children}
    </section>
  )
}

function ReportLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minHeight: 32,
        padding: '0 11px',
        borderRadius: 7,
        border: `1px solid ${tokens.hair}`,
        color: tokens.strong,
        background: tokens.raised,
        textDecoration: 'none',
        fontFamily: tokens.mono,
        fontSize: 11,
      }}
    >
      {icon}
      {label}
    </a>
  )
}

function LoadingBlock() {
  return <div className="shimmer" style={{ height: 180, borderRadius: 8 }} />
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <Panel>
      <Mono color={tokens.err}>Analytics unavailable</Mono>
      <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 6 }}>{message}</Mono>
    </Panel>
  )
}

function TableTitle({ title, meta }: { title: string; meta: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 10 }}>
      <h3 style={{ margin: 0, fontFamily: tokens.mono, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: tokens.dim }}>
        {title}
      </h3>
      <Mono size={10} color={tokens.dim}>{meta}</Mono>
    </div>
  )
}

function rangeTitle(from: string | null, to: string): string {
  if (from == null) return `until ${to.slice(0, 10)}`
  return `${from.slice(0, 10)} to ${to.slice(0, 10)}`
}

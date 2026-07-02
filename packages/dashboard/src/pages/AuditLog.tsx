import { History } from 'lucide-react'
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAuditLog } from '@/api/hooks'
import { Btn, Card, Mono, Page, PageHeader, tokens } from '@/components/signal'
import { downloadEvidenceBundleByRunId } from './run-detail/transcript'
import { AuditLogFilters } from './audit-log/Filters'
import { queryFromSearch } from './audit-log/helpers'
import { AuditLogRows } from './audit-log/Rows'

export function AuditLog() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = useMemo(() => queryFromSearch(searchParams), [searchParams])
  const audit = useAuditLog(query)
  const activeCount = Array.from(searchParams.keys()).filter((key) => key !== 'limit' && key !== 'cursor').length

  function applyFilters(next: URLSearchParams) {
    setSearchParams(next, { replace: false })
  }

  function nextPage(cursor: string) {
    const next = new URLSearchParams(searchParams)
    next.set('cursor', cursor)
    setSearchParams(next, { replace: false })
  }

  return (
    <Page maxWidth={1320}>
      <PageHeader
        eyebrow="Audit"
        title="Audit Log"
        icon={<History className="h-4 w-4" />}
        subtitle="Operator-visible history across decisions, run lifecycle events, recovery actions, settings changes, and secret access."
        metrics={(
          <>
            <Mono size={11} color={tokens.dim}>{activeCount} filters active</Mono>
            {audit.data?.nextCursor != null && <Mono size={11} color={tokens.accent}>more results available</Mono>}
          </>
        )}
      />

      <div style={{ display: 'grid', gap: 16 }}>
        {query.runId != null && (
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <Mono size={12} color={tokens.mid}>Run scope active. Export the decision/evidence hash manifest for this attempt.</Mono>
              <Btn onClick={() => void downloadEvidenceBundleByRunId(query.runId!)}>Download evidence bundle</Btn>
            </div>
          </Card>
        )}
        <AuditLogFilters
          params={searchParams}
          onApply={applyFilters}
          onClear={() => setSearchParams(new URLSearchParams({ limit: '50' }), { replace: false })}
        />
        {audit.isLoading ? (
          <div aria-label="Loading audit log" className="shimmer" style={{ height: 220, borderRadius: 10, border: `1px solid ${tokens.hair}` }} />
        ) : audit.isError ? (
          <Card>
            <Mono size={12} color={tokens.err}>Audit log could not be loaded.</Mono>
            <p style={{ color: tokens.mid, fontSize: 13, margin: '8px 0 0' }}>
              {audit.error instanceof Error ? audit.error.message : 'Unknown API error'}
            </p>
          </Card>
        ) : (
          <AuditLogRows
            items={audit.data?.items ?? []}
            nextCursor={audit.data?.nextCursor ?? null}
            onNextPage={nextPage}
          />
        )}
      </div>
    </Page>
  )
}

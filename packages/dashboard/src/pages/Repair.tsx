import { Wrench } from 'lucide-react'
import { useMemo } from 'react'

import { useProjects, useRepairReport } from '@/api/hooks'
import type { ApiRepairGroup, ApiRepairItem } from '@/api/client'
import { Btn, Card, CardHeader, MetricPill, Mono, Page, PageHeader, tokens } from '@/components/signal'
import { RepairGroupSection } from '@/components/repair/RepairGroupSection'
import { RepairAreasLegend, RepairEmptyState } from '@/components/repair/RepairOverview'
import type { RepairGroup, RepairItem } from '@/lib/repair'

export function Repair() {
  const { data: report, isLoading, isError, error, isFetching, refetch } = useRepairReport()
  const { data: projects } = useProjects()

  const groups = useMemo(() => (report?.groups ?? []).map(adaptGroup), [report])
  const counts = report?.summary.byArea
  const severity = { blocker: report?.summary.blockers ?? 0, warning: report?.summary.attention ?? 0 }

  if (isLoading) {
    return (
      <Page maxWidth={1040}>
        <PageHeader
          eyebrow="Repair"
          title="Repair"
          icon={<Wrench className="h-4 w-4" />}
          subtitle="Loading repair report."
          metrics={<MetricPill label="items" value="loading" />}
        />
        <Card>
          <CardHeader title="Reading repair report" meta="Setup, readiness, and execution-integrity checks." />
          <div className="shimmer" style={{ height: 28, borderRadius: 7, marginBottom: 10 }} />
          <div className="shimmer" style={{ height: 180, borderRadius: 7 }} />
          <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 10 }}>
            Waiting for the latest factory setup, project readiness, provider auth, workflow validity, spec start, and attempt recovery checks.
          </Mono>
        </Card>
      </Page>
    )
  }

  if (isError) {
    return (
      <Page maxWidth={1040}>
        <PageHeader
          eyebrow="Repair"
          title="Repair"
          icon={<Wrench className="h-4 w-4" />}
          subtitle="Repair report unavailable."
          metrics={<MetricPill label="items" value="error" tone="err" />}
        />
        <Card>
          <CardHeader
            title="Repair report unavailable"
            meta="The /api/repair request failed, so we cannot show setup, readiness, or execution-integrity items."
            action={<Btn small onClick={() => void refetch()} disabled={isFetching}>Retry</Btn>}
            tone={tokens.err}
          />
          <Mono size={12} color={tokens.mid} style={{ overflowWrap: 'anywhere' }}>
            {error instanceof Error ? error.message : 'Unknown error'}
          </Mono>
        </Card>
      </Page>
    )
  }

  return (
    <Page maxWidth={1040}>
      <PageHeader
        eyebrow="Repair"
        title="Repair"
        icon={<Wrench className="h-4 w-4" />}
        subtitle="Blocked setup, readiness, and execution-integrity issues — grouped by what they block, pointed at the exact record, with a suggested next action."
        metrics={(
          <>
	            <MetricPill label="items" value={report?.summary.total ?? 0} />
	            <MetricPill label="blockers" value={severity.blocker} tone="err" />
	            <MetricPill label="fix soon" value={severity.warning} tone="warn" />
          </>
        )}
      />
      <div style={{ display: 'grid', gap: 20 }}>
        {groups.length === 0 ? (
          <RepairEmptyState hasProjects={(projects?.length ?? 0) > 0} />
        ) : (
          groups.map((group) => <RepairGroupSection key={group.area} group={group} />)
        )}
        <RepairAreasLegend counts={counts ?? emptyAreaCounts()} />
      </div>
    </Page>
  )
}

function adaptGroup(group: ApiRepairGroup): RepairGroup {
  return { ...group, items: group.items.map(adaptItem) }
}

function adaptItem(item: ApiRepairItem): RepairItem {
  return {
    ...item,
    record: formatRecord(item),
    field: `${item.field.label} (${item.field.path})`,
    target: item.target == null ? null : {
      project: item.target.projectName,
      spec: item.target.specName,
      task: item.target.taskName,
      attempt: item.target.attemptId,
    },
  }
}

function formatRecord(item: ApiRepairItem): string {
  const name = item.record.name == null ? item.record.type : `${item.record.type} ${item.record.name}`
  return item.record.id == null ? name : `${name} (${item.record.id})`
}

function emptyAreaCounts() {
  return {
    factory_setup: 0,
    project_readiness: 0,
    repository_readiness: 0,
    agent_readiness: 0,
    provider_auth: 0,
    workflow_validity: 0,
    spec_start: 0,
    attempt_recovery: 0,
    migration: 0,
  }
}

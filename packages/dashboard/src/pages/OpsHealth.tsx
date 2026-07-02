import { Activity } from 'lucide-react'

import { useOpsHealth } from '@/api/hooks'
import type { OpsHealthReport, OpsHealthStatus } from '@/api/client'
import { MetricPill, Page, PageHeader } from '@/components/signal'
import { CleanupWorktreesCard } from '@/components/ops-health/CleanupWorktreesCard'
import { DatabaseStatusCard } from '@/components/ops-health/DatabaseStatusCard'
import { ProcessStatusCard } from '@/components/ops-health/ProcessStatusCard'
import { RecentLogsCard } from '@/components/ops-health/RecentLogsCard'
import { WorktreeInventoryCard } from '@/components/ops-health/WorktreeInventoryCard'
import { formatBytes } from '@/lib/ops-health-format'

export function OpsHealth() {
  const { data: report, isLoading, isError, error } = useOpsHealth()

  return (
    <Page maxWidth={1180}>
      <PageHeader
        eyebrow="Ops Health"
        title="Ops Health"
        icon={<Activity className="h-4 w-4" />}
        metrics={report == null ? undefined : (
          <>
            <MetricPill label="overall" value={report.status} tone={statusTone(report.status)} />
            <MetricPill
              label="dispatcher"
              value={report.process.dispatcher.running ? 'running' : report.process.dispatcher.enabled ? 'enabled' : 'off'}
              tone={report.process.dispatcher.running ? 'ok' : 'warn'}
            />
            <MetricPill
              label="worktrees"
              value={report.worktrees.directoryCount}
              tone="info"
              title={report.worktrees.basePath ?? 'No base path configured'}
            />
            <MetricPill
              label="disk"
              value={report.worktrees.measurable ? formatBytes(report.worktrees.totalBytes) : '—'}
              tone="default"
            />
            <MetricPill
              label="doctor"
              value={`${report.doctor.summary.ready}/${report.doctor.summary.ready + report.doctor.summary.blocked + report.doctor.summary.deferred}`}
              tone={report.doctor.status === 'ready' ? 'ok' : report.doctor.status === 'blocked' ? 'err' : 'warn'}
            />
          </>
        )}
      />
      {isLoading ? (
        <div className="shimmer" style={{ height: 220, borderRadius: 10, marginBottom: 16 }} />
      ) : isError ? (
        <OpsHealthError message={error instanceof Error ? error.message : String(error)} />
      ) : report == null ? (
        <OpsHealthError message="Ops Health returned no report." />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <ProcessStatusCard process={report.process} doctor={report.doctor} />
          <WorktreeInventoryCard inventory={report.worktrees} />
          <DatabaseStatusCard database={report.database} />
          <RecentLogsCard logs={report.logs} />
          <CleanupWorktreesCard inventory={report.worktrees} />
        </div>
      )}
    </Page>
  )
}

function OpsHealthError({ message }: { message: string }) {
  return (
    <section
      role="alert"
      style={{
        border: '1px solid rgba(248, 113, 113, 0.55)',
        background: 'rgba(127, 29, 29, 0.18)',
        borderRadius: 8,
        padding: 16,
        color: '#fecaca',
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Ops Health unavailable</div>
      <div>{message}</div>
    </section>
  )
}

function statusTone(status: OpsHealthStatus): 'ok' | 'warn' | 'err' | 'default' {
  if (status === 'ready') return 'ok'
  if (status === 'degraded') return 'warn'
  if (status === 'blocked') return 'err'
  return 'default'
}

export type { OpsHealthReport }

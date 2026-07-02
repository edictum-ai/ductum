import { Link } from 'react-router-dom'

import type { OpsHealthLogs, OpsHealthLogEntry } from '@/api/client'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { formatTimestamp } from '@/lib/ops-health-format'

export function RecentLogsCard({ logs }: { logs: OpsHealthLogs | { available: false; reason: string } }) {
  return (
    <Card>
      <CardHeader
        title="Recent operational logs"
        meta={logs.available ? `${logs.recent.length} recent event(s)` : 'audit log unavailable'}
        action={<Link to="/audit" style={{ color: tokens.accent, fontSize: 12, whiteSpace: 'nowrap' }}>Audit</Link>}
      />
      {logs.available ? <LogsTable entries={logs.recent} /> : <Unavailable reason={logs.reason} />}
    </Card>
  )
}

function LogsTable({ entries }: { entries: OpsHealthLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div style={{ padding: '8px 10px', border: `1px solid ${tokens.info}`, borderRadius: 6, color: tokens.info, fontSize: 12 }}>
        No audit-log events recorded yet. Operator mutations (settings updates, run approvals, cleanup) will appear here.
      </div>
    )
  }
  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto', borderTop: `1px solid ${tokens.hair}` }}>
      <div style={{ display: 'grid', gap: 0 }}>
      {entries.map((entry) => (
        <div
          key={entry.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 110px 1fr',
            gap: 10,
            padding: '6px 10px',
            borderBottom: `1px solid ${tokens.hair}`,
            alignItems: 'baseline',
          }}
        >
          <Mono size={10} color={tokens.dim}>{formatTimestamp(entry.occurredAt)}</Mono>
          <StatusBadge status={entry.status} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: tokens.strong }}>{entry.title}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
              <Mono size={10} color={tokens.dim}>{entry.eventType}</Mono>
              {entry.actor != null && <Mono size={10} color={tokens.dim}>· {entry.actor}</Mono>}
              {entry.projectName != null && <Mono size={10} color={tokens.dim}>· {entry.projectName}</Mono>}
              {entry.taskName != null && <Mono size={10} color={tokens.dim}>· {entry.taskName}</Mono>}
            </div>
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div style={{ padding: '8px 10px', border: `1px solid ${tokens.warn}`, borderRadius: 6, color: tokens.warn, fontSize: 12 }}>
      {reason}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const tone = statusTone(status)
  const color = tone === 'ok' ? tokens.ok : tone === 'warn' ? tokens.warn : tone === 'err' ? tokens.err : tokens.info
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${color}`, color: color as string, borderRadius: 4, fontFamily: tokens.mono, textTransform: 'uppercase' }}>
      {status}
    </span>
  )
}

function statusTone(status: string): 'ok' | 'warn' | 'err' | 'info' {
  if (['success', 'applied', 'ready', 'recorded'].includes(status)) return 'ok'
  if (['restart_required', 'deferred', 'skipped'].includes(status)) return 'warn'
  if (['error', 'failed', 'blocked', 'missing', 'unavailable'].includes(status)) return 'err'
  return 'info'
}

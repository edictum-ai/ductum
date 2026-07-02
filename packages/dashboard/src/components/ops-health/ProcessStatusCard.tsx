import { Link } from 'react-router-dom'

import type { OpsHealthDoctor, OpsHealthProcess } from '@/api/client'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { formatDuration } from '@/lib/ops-health-format'

export function ProcessStatusCard({ process, doctor }: { process: OpsHealthProcess; doctor: OpsHealthDoctor }) {
  return (
    <Card>
      <CardHeader
        title="Process & dispatcher"
        meta={process.dispatcher.enabled ? `adapters: ${process.dispatcher.adapters.join(', ') || 'none'}` : 'dispatcher disabled'}
        action={<Link to="/repair" style={{ color: tokens.accent, fontSize: 12, whiteSpace: 'nowrap' }}>Repair</Link>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Bind host" value={process.apiBindHost ?? 'unknown'} />
        <Field label="Port" value={process.apiPort == null ? 'unknown' : String(process.apiPort)} />
        <Field label="Public URL" value={process.publicApiUrl ?? 'not set'} />
        <Field label="Dashboard URL" value={process.dashboardUrl ?? 'not set'} />
        <Field
          label="Dispatcher"
          value={process.dispatcher.running ? 'running' : process.dispatcher.enabled ? 'enabled (idle)' : 'disabled'}
          tone={process.dispatcher.running ? 'ok' : process.dispatcher.enabled ? 'warn' : 'err'}
        />
        <Field label="Active runs" value={String(process.dispatcher.activeRuns)} />
        <Field
          label="Doctor"
          value={`${doctor.summary.ready} ready · ${doctor.summary.blocked} blocked · ${doctor.summary.deferred} deferred`}
          tone={doctor.status === 'ready' ? 'ok' : doctor.status === 'blocked' ? 'err' : 'warn'}
        />
        <Field
          label="Uptime"
          value={process.uptimeSeconds == null ? 'unknown' : formatDuration(process.uptimeSeconds)}
        />
        {process.dispatcher.reason != null && (
          <Field label="Reason" value={process.dispatcher.reason} tone="warn" />
        )}
      </div>
    </Card>
  )
}

function Field({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'ok' | 'warn' | 'err'
}) {
  const color = toneColor(tone)
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: tokens.dim }}>{label}</span>
      <Mono size={12} color={color} style={{ wordBreak: 'break-word' }}>{value}</Mono>
    </div>
  )
}

function toneColor(tone: 'default' | 'ok' | 'warn' | 'err'): string {
  if (tone === 'ok') return tokens.ok
  if (tone === 'warn') return tokens.warn
  if (tone === 'err') return tokens.err
  return tokens.mid
}

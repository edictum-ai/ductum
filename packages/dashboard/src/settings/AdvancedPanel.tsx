import { useFactoryRuntime } from '@/api/hooks'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { errorText } from '@/settings/controls'

/**
 * Read-only process-owned facts from GET /api/factory/runtime. These values
 * are set at startup or owned by the running process; there is no edit path
 * here and no raw config editor.
 */
export function AdvancedPanel() {
  const runtime = useFactoryRuntime()

  if (runtime.isLoading) {
    return (
      <Card>
        <CardHeader title="Advanced" meta="process-owned · read-only" />
        <Mono color={tokens.faint}>loading…</Mono>
      </Card>
    )
  }
  if (runtime.error != null || runtime.data == null) {
    return (
      <Card>
        <CardHeader title="Advanced" meta="process-owned · read-only" tone={tokens.warn} />
        <Mono color={tokens.err}>{errorText(runtime.error ?? new Error('Runtime facts unavailable'))}</Mono>
      </Card>
    )
  }

  const current = runtime.data.current
  if (current == null) {
    return (
      <Card>
        <CardHeader title="Advanced" meta="process-owned · read-only" />
        <Mono color={tokens.faint}>No running factory process observed</Mono>
      </Card>
    )
  }

  const merge = current.mergeConfig
  const budget = current.costBudget
  const profiles = current.workflowProfiles.entries
  return (
    <Card>
      <CardHeader title="Advanced" meta="process-owned · read-only" />
      <div data-testid="settings-process-facts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px 18px' }}>
        <Row label="effective heartbeat timeout" value={current.heartbeatTimeoutSeconds == null ? '—' : `${current.heartbeatTimeoutSeconds}s`} />
        <Row label="merge" value={`${merge.strategy} → ${merge.base}${merge.push ? ' · push' : ''}${merge.pushTags ? ' · tags' : ''}`} />
        <Row
          label="effective budget"
          value={[
            budget.perRunWarnUsd != null ? `warn $${budget.perRunWarnUsd}` : null,
            budget.perRunHardUsd != null ? `run $${budget.perRunHardUsd}` : null,
            budget.perSpecHardUsd != null ? `spec $${budget.perSpecHardUsd}` : null,
          ].filter(Boolean).join(' · ') || 'none'}
        />
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${tokens.hair}` }}>
        <Mono size={10.5} color={tokens.faint}>loaded workflow profiles</Mono>
        {profiles.length === 0 ? (
          <Mono size={11.5} color={tokens.faint} style={{ display: 'block', marginTop: 4 }}>none loaded</Mono>
        ) : (
          profiles.map((profile) => (
            <Mono key={`${profile.projectId ?? 'factory'}:${profile.name}`} size={11.5} color={tokens.mid} style={{ display: 'block', marginTop: 4, overflowWrap: 'anywhere' }}>
              {profile.name} → {profile.path} ({profile.source})
            </Mono>
          ))
        )}
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <Mono size={10.5} color={tokens.faint}>{label}</Mono>
      <Mono size={11.5} color={tokens.fg} style={{ display: 'block', marginTop: 2, overflowWrap: 'anywhere' }}>{value}</Mono>
    </div>
  )
}

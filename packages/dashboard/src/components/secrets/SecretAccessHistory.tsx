import { Link } from 'react-router-dom'

import type { PublicSecretAccessEvent } from '@/api/client'
import type { FactorySecretMetadata } from '@/api/factory-settings-types'
import {
  useRunSecretAccessHistory,
  useSecretAccessHistory,
} from '@/api/hooks'
import { Caps, Dot, Mono, ago, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { redactSensitiveText } from '@/lib/run-activity-labels'

type AccessHistoryMode = 'secret' | 'run'

export function SecretAccessHistoryForSecret({
  secret,
}: {
  secret: FactorySecretMetadata
}) {
  const history = useSecretAccessHistory(secret.id, 3)
  return (
    <div>
      <Caps color={tokens.dim} style={{ fontSize: 10, letterSpacing: 1.2, marginBottom: 6 }}>
        Recent access
      </Caps>
      <SecretAccessHistoryList
        mode="secret"
        events={history.data}
        loading={history.isLoading}
        error={history.error}
      />
    </div>
  )
}

export function RunSecretAccessCard({ runId }: { runId: string }) {
  const history = useRunSecretAccessHistory(runId, 50)
  return (
    <div
      style={{
        background: tokens.canvas,
        border: `1px solid ${tokens.hair}`,
        borderRadius: 10,
        marginBottom: 24,
        padding: '18px 20px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <Caps>Secret access</Caps>
        <Mono size={11} color={tokens.dim}>
          value-free history
        </Mono>
      </div>
      <SecretAccessHistoryList
        mode="run"
        events={history.data}
        loading={history.isLoading}
        error={history.error}
      />
    </div>
  )
}

function SecretAccessHistoryList({
  mode,
  events,
  loading,
  error,
}: {
  mode: AccessHistoryMode
  events: PublicSecretAccessEvent[] | undefined
  loading: boolean
  error: unknown
}) {
  if (error != null) {
    return (
      <Mono color={tokens.err} style={{ display: 'block', lineHeight: 1.5 }}>
        {mode === 'run'
          ? 'Secret access history unavailable. Do not treat this as no secret use.'
          : 'Access history unavailable. Do not treat this as no secret use.'}
      </Mono>
    )
  }
  if (loading && events == null) {
    return <Mono color={tokens.faint}>Loading access history...</Mono>
  }
  if (events == null || events.length === 0) {
    return (
      <Mono color={tokens.faint}>
        {mode === 'run' ? 'No secret access events recorded for this attempt.' : 'No access events recorded yet.'}
      </Mono>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {events.map((event) => (
        <AccessEventRow
          key={event.id}
          event={event}
          mode={mode}
        />
      ))}
    </div>
  )
}

function AccessEventRow({
  event,
  mode,
}: {
  event: PublicSecretAccessEvent
  mode: AccessHistoryMode
}) {
  const secretId = secretIdFromRef(event.secretRef)
  const outcomeColor = event.outcome === 'success' ? tokens.ok : tokens.err
  const sanitizedErrorMessage = event.errorMessage == null ? null : redactSensitiveText(event.errorMessage)
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        minWidth: 0,
        fontFamily: tokens.sans,
        fontSize: 12,
        color: tokens.mid,
        lineHeight: 1.45,
      }}
    >
      <Dot color={outcomeColor} size={7} style={{ marginTop: 5 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Mono size={11} color={outcomeColor}>{event.outcome}</Mono>
          {mode === 'run' && (
            <Mono size={11} color={tokens.strong}>
              {secretLabel(secretId)}
            </Mono>
          )}
          {event.runId != null && (
            <Link
              to={`/runs/${encodeURIComponent(event.runId)}`}
              style={{ fontFamily: tokens.mono, fontSize: 11, color: tokens.accent }}
            >
              run {shortId(event.runId)}
            </Link>
          )}
          <Mono size={11} color={tokens.dim}>
            {event.agentId == null ? 'operator' : `agent ${shortId(event.agentId)}`}
          </Mono>
          <Mono size={11} color={tokens.dim}>{ago(event.attemptedAt)} ago</Mono>
        </div>
        {sanitizedErrorMessage != null && sanitizedErrorMessage.trim() !== '' && (
          <Mono size={11} color={tokens.err} style={{ display: 'block', marginTop: 2, overflowWrap: 'anywhere' }}>
            {sanitizedErrorMessage}
          </Mono>
        )}
      </div>
    </div>
  )
}

function secretIdFromRef(secretRef: string | null): string | null {
  if (secretRef == null) return null
  if (!secretRef.startsWith('secret:')) return null
  const id = secretRef.slice('secret:'.length)
  return id === '' ? null : id
}

function secretLabel(secretId: string | null): string {
  if (secretId == null) return 'malformed secret ref'
  return `secret:${shortId(secretId)}`
}

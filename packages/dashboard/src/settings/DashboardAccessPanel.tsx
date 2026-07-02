import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import {
  useCreateOperatorSession,
  useCurrentOperatorSession,
  useOperatorSessions,
  useRevokeOperatorSession,
} from '@/api/hooks'
import { Btn, Card, CardHeader, Dot, Mono, ago, tokens } from '@/components/signal'

const LEGACY_STORAGE_KEY = 'ductum.operatorToken'

type SessionState = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'pass'; label: string } | { kind: 'fail'; reason: string }

export function DashboardAccessPanel({ onSaved, onCleared }: { onSaved?: () => void; onCleared?: () => void } = {}) {
  const [browserLink, setBrowserLink] = useState('')
  const [session, setSession] = useState<SessionState>({ kind: 'idle' })
  const current = useCurrentOperatorSession()
  const createScoped = useCreateOperatorSession()
  const revoke = useRevokeOperatorSession()
  const canManage = current.data?.scopes.includes('operator') === true || current.data?.kind === 'operator-token'
  const sessions = useOperatorSessions(canManage)

  useEffect(() => {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
  }, [])

  async function clear() {
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
    setSession({ kind: 'busy', label: 'clearing...' })
    await api.disconnectBrowserSession().catch(() => null)
    setSession({ kind: 'idle' })
    onCleared?.()
  }

  async function checkSession() {
    setSession({ kind: 'busy', label: 'checking...' })
    try {
      await api.getFactory()
      await refreshSessionState()
      setSession({ kind: 'pass', label: 'Session connected' })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'verification failed'
      setSession({ kind: 'fail', reason })
    }
  }

  async function reconnect() {
    setSession({ kind: 'busy', label: 'reconnecting...' })
    try {
      const result = await api.reconnectBrowserSession()
      if (!result.ok) {
        setSession({ kind: 'fail', reason: result.reason ?? 'Local reconnect unavailable' })
        return
      }
      globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
      await refreshSessionState()
      setSession({ kind: 'pass', label: 'Session connected' })
      onSaved?.()
    } catch (err) {
      setSession({ kind: 'fail', reason: err instanceof Error ? err.message : 'Local reconnect failed' })
    }
  }

  async function pair() {
    const code = browserCodeFromInput(browserLink)
    if (code === '') {
      setSession({ kind: 'fail', reason: 'Browser link or code is required' })
      return
    }
    setSession({ kind: 'busy', label: 'connecting...' })
    try {
      await api.exchangeWelcomeHandoff(code)
      globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
      setBrowserLink('')
      await refreshSessionState()
      setSession({ kind: 'pass', label: 'Session connected' })
      onSaved?.()
    } catch (err) {
      setSession({ kind: 'fail', reason: err instanceof Error ? err.message : 'Connection failed' })
    }
  }

  const connected = session.kind === 'pass'
  const busy = session.kind === 'busy'
  const statusText = session.kind === 'pass'
      ? session.label
      : session.kind === 'busy'
        ? session.label
        : 'Browser session not checked'

  return (
    <div id="api-access">
      <Card>
        <CardHeader title="Dashboard session" meta={connected ? 'connected in this browser' : 'local handoff preferred'} />
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot color={connected ? tokens.ok : tokens.mid} pulse={connected || busy} />
            <span
              data-testid="operator-session-status"
              style={{
                fontFamily: tokens.mono,
                fontSize: 12,
                color: connected ? tokens.ok : tokens.mid,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {statusText}
            </span>
          </div>
          <Mono size={11} color={tokens.dim}>
            Local starts create an HttpOnly browser session. If this tab was
            opened directly, reconnect locally or paste the one-time browser
            link printed by the CLI.
          </Mono>
          <CurrentSessionLine current={current.data} loading={current.isLoading} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              data-testid="dashboard-pairing-code"
              aria-label="Browser link or code"
              name="dashboard-pairing-code"
              value={browserLink}
              onChange={(event) => setBrowserLink(event.target.value)}
              placeholder="Paste browser link or code"
              disabled={busy}
              style={{
                flex: '1 1 220px',
                minWidth: 0,
                border: `1px solid ${tokens.rule}`,
                borderRadius: 7,
                background: tokens.raised,
                color: tokens.fg,
                padding: '8px 10px',
                fontFamily: tokens.mono,
                fontSize: 12,
              }}
            />
            <Btn
              data-testid="dashboard-pairing-submit"
              onClick={pair}
              disabled={busy}
            >
              Connect
            </Btn>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {session.kind === 'pass' && (
              <Mono size={11} color={tokens.ok}>{session.label}</Mono>
            )}
            {session.kind === 'fail' && (
              <Mono size={11} color={tokens.err}>{session.reason}</Mono>
            )}
            {session.kind === 'busy' && (
              <Mono size={11} color={tokens.dim}>{session.label}</Mono>
            )}
            <Btn
              data-testid="operator-session-check"
              onClick={checkSession}
              disabled={busy}
            >
              Check session
            </Btn>
            <Btn
              data-testid="operator-session-reconnect"
              onClick={reconnect}
              disabled={busy}
            >
              Reconnect locally
            </Btn>
            <Btn onClick={clear} disabled={busy}>Clear browser access</Btn>
          </div>
          <div style={{ borderTop: `1px solid ${tokens.hair}`, paddingTop: 12, display: 'grid', gap: 10 }}>
            <Mono size={10.5} color={tokens.faint}>THIS BROWSER SCOPE</Mono>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['operator', 'approver', 'read'] as const).map((scope) => (
                <Btn
                  key={scope}
                  small
                  disabled={!canManage || createScoped.isPending || busy}
                  onClick={() => switchScope(scope)}
                  data-testid={`operator-session-scope-${scope}`}
                >
                  {scope === 'read' ? 'Read-only' : scope}
                </Btn>
              ))}
            </div>
            {!canManage && (
              <Mono size={11} color={tokens.warn}>Current scope cannot create or revoke sessions. Reconnect locally for operator scope.</Mono>
            )}
            <SessionRows
              sessions={sessions.data?.sessions ?? []}
              currentId={current.data?.sessionId ?? null}
              busy={revoke.isPending}
              canManage={canManage}
              onRevoke={(id) => revoke.mutate(id)}
            />
          </div>
        </div>
      </Card>
    </div>
  )

  async function refreshSessionState() {
    await Promise.all([
      current.refetch(),
      canManage ? sessions.refetch() : Promise.resolve(),
    ])
  }

  function switchScope(scope: 'operator' | 'approver' | 'read') {
    const scopes = scope === 'read' ? ['read' as const] : [scope]
    createScoped.mutate({ scopes, makeCurrent: true }, {
      onSuccess: () => {
        setSession({ kind: 'pass', label: 'Session connected' })
        onSaved?.()
      },
      onError: (err) => setSession({ kind: 'fail', reason: err instanceof Error ? err.message : 'Session update failed' }),
    })
  }
}

function CurrentSessionLine({
  current,
  loading,
}: {
  current: Awaited<ReturnType<typeof api.getCurrentOperatorSession>> | undefined
  loading: boolean
}) {
  if (loading) return <Mono size={11} color={tokens.dim}>checking current session...</Mono>
  if (current == null || !current.authenticated) return <Mono size={11} color={tokens.warn}>No authenticated dashboard session.</Mono>
  return (
    <span data-testid="operator-session-current">
      <Mono size={11} color={tokens.mid}>
        {current.actor ?? 'unknown'} · {current.scopes.join('/')} · {current.projectIds == null ? 'all projects' : `${current.projectIds.length} project scope`}
      </Mono>
    </span>
  )
}

function SessionRows({
  sessions,
  currentId,
  busy,
  canManage,
  onRevoke,
}: {
  sessions: Awaited<ReturnType<typeof api.listOperatorSessions>>['sessions']
  currentId: string | null
  busy: boolean
  canManage: boolean
  onRevoke: (id: string) => void
}) {
  if (sessions.length === 0) return <Mono size={11} color={tokens.faint}>No browser sessions stored.</Mono>
  return (
    <div style={{ display: 'grid', gap: 8 }} data-testid="operator-session-list">
      {sessions.slice(0, 8).map((item) => {
        const revoked = item.revokedAt != null
        return (
          <div key={item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Mono size={11} color={revoked ? tokens.faint : tokens.mid} style={{ flex: '1 1 240px' }}>
              {item.actor} · {item.scopes.join('/')} · expires {ago(item.expiresAt)}{currentId === item.id ? ' · current' : ''}
            </Mono>
            <Btn small disabled={!canManage || busy || revoked || currentId === item.id} onClick={() => onRevoke(item.id)}>
              Revoke
            </Btn>
          </div>
        )
      })}
    </div>
  )
}

function browserCodeFromInput(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  try {
    const parsed = new URL(trimmed, window.location.origin)
    return parsed.searchParams.get('pair')?.trim() ?? parsed.searchParams.get('token')?.trim() ?? trimmed
  } catch {
    return trimmed
  }
}

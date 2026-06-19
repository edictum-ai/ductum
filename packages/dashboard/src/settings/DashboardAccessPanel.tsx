import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { Btn, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'

const STORAGE_KEY = 'ductum.operatorToken'

type SessionState = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'pass'; label: string } | { kind: 'fail'; reason: string }

export function DashboardAccessPanel({ onSaved, onCleared }: { onSaved?: () => void; onCleared?: () => void } = {}) {
  const [legacyManualSaved, setLegacyManualSaved] = useState(false)
  const [session, setSession] = useState<SessionState>({ kind: 'idle' })

  useEffect(() => {
    const existing = globalThis.localStorage?.getItem(STORAGE_KEY) ?? ''
    setLegacyManualSaved(existing.trim() !== '')
  }, [])

  async function clear() {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
    setLegacyManualSaved(false)
    setSession({ kind: 'busy', label: 'clearing...' })
    await api.disconnectBrowserSession().catch(() => null)
    setSession({ kind: 'idle' })
    onCleared?.()
  }

  async function checkSession() {
    setSession({ kind: 'busy', label: 'checking...' })
    try {
      await api.getFactory()
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
      globalThis.localStorage?.removeItem(STORAGE_KEY)
      setLegacyManualSaved(false)
      setSession({ kind: 'pass', label: 'Session connected' })
      onSaved?.()
    } catch (err) {
      setSession({ kind: 'fail', reason: err instanceof Error ? err.message : 'Local reconnect failed' })
    }
  }

  const connected = session.kind === 'pass'
  const busy = session.kind === 'busy'
  const statusText = session.kind === 'pass'
    ? session.label
    : session.kind === 'busy'
      ? session.label
      : legacyManualSaved
        ? 'Legacy manual key stored'
        : 'Browser session preferred'

  return (
    <div id="api-access">
      <Card>
        <CardHeader title="Dashboard session" meta={connected ? 'connected in this browser' : 'local handoff preferred'} />
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot color={connected ? tokens.ok : legacyManualSaved ? tokens.warn : tokens.mid} pulse={connected || busy} />
            <span
              data-testid="operator-session-status"
              style={{
                fontFamily: tokens.mono,
                fontSize: 12,
                color: connected ? tokens.ok : legacyManualSaved ? tokens.warn : tokens.mid,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {statusText}
            </span>
          </div>
          <Mono size={11} color={tokens.dim}>
            Local starts use a short-lived handoff and an HttpOnly browser cookie. Reconnect refreshes that session without exposing the operator credential to this page.
          </Mono>
          {legacyManualSaved && (
            <Mono size={11} color={tokens.warn}>
              A legacy manual key is stored in this browser. Reconnect replaces it with a cookie session; Clear removes it.
            </Mono>
          )}
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
        </div>
      </Card>
    </div>
  )
}

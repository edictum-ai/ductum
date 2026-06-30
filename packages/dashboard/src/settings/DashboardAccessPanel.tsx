import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { Btn, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'

const LEGACY_STORAGE_KEY = 'ductum.operatorToken'

type SessionState = { kind: 'idle' } | { kind: 'busy'; label: string } | { kind: 'pass'; label: string } | { kind: 'fail'; reason: string }

export function DashboardAccessPanel({ onSaved, onCleared }: { onSaved?: () => void; onCleared?: () => void } = {}) {
  const [browserLink, setBrowserLink] = useState('')
  const [session, setSession] = useState<SessionState>({ kind: 'idle' })

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
        </div>
      </Card>
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

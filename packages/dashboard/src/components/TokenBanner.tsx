import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { Btn, Mono, tokens } from '@/components/signal'

const STORAGE_KEY = 'ductum.operatorToken'

/**
 * Renders a top-of-page banner whenever the API rejects the dashboard
 * for missing or invalid operator credentials. Local browser handoff is
 * the primary path; local reconnect refreshes the HttpOnly cookie without
 * exposing the operator credential to dashboard JavaScript.
 */
export function TokenBanner() {
  const [authError, setAuthError] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    function onAuthError() {
      setAuthError(true)
      setDismissed(false)
    }
    window.addEventListener('ductum:auth-error', onAuthError as EventListener)
    return () => {
      window.removeEventListener('ductum:auth-error', onAuthError as EventListener)
    }
  }, [])

  const visible = !dismissed && authError
  if (!visible) return null

  async function reconnect() {
    setDetecting(true)
    setError(null)
    try {
      const result = await api.reconnectBrowserSession()
      if (!result.ok) {
        setError(result.reason ?? 'Local reconnect unavailable')
        return
      }
      globalThis.localStorage?.removeItem(STORAGE_KEY)
      setAuthError(false)
      // Reload so every active query refetches with the new header.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local reconnect failed')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div
      role="alert"
      data-testid="token-banner"
      style={{
        background: 'color-mix(in srgb, var(--signal-warn) 16%, transparent)',
        borderBottom: `1px solid ${tokens.warn}`,
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 240 }}>
        <Mono size={12} color={tokens.strong}>
          Reconnect dashboard
        </Mono>
        <Mono size={11} color={tokens.dim}>
          Local <code>ductum start</code> normally opens an authenticated
          browser session. This tab was opened without that handoff, or its
          session expired. Reconnect locally when enabled; remote login is
          still a follow-up.
        </Mono>
        {error != null && (
          <Mono size={11} color={tokens.err}>
            {error}
          </Mono>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <a
          href="/settings#api-access"
          data-testid="token-banner-settings"
          style={{
            padding: '7px 14px',
            fontFamily: tokens.sans,
            fontSize: 13,
            fontWeight: 500,
            color: tokens.fg,
            background: tokens.raised,
            border: `1px solid ${tokens.rule}`,
            borderRadius: 7,
            textDecoration: 'none',
          }}
        >
          Session settings
        </a>
        <Btn
          data-testid="token-banner-autodetect"
          onClick={reconnect}
          disabled={detecting}
        >
          {detecting ? 'Reconnecting...' : 'Reconnect locally'}
        </Btn>
        <Btn onClick={() => setDismissed(true)}>Dismiss</Btn>
      </div>
    </div>
  )
}

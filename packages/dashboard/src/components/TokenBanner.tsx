import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { Btn, Mono, tokens } from '@/components/signal'

const STORAGE_KEY = 'ductum.operatorToken'

/**
 * Renders a top-of-page banner whenever the API rejects the dashboard
 * for missing or invalid operator credentials. Offers a one-click
 * auto-detect button for local opt-in API processes and stores the token
 * in localStorage so the page can recover without a manual copy-paste.
 */
export function TokenBanner() {
  const [authError, setAuthError] = useState(false)
  const [tokenProtected, setTokenProtected] = useState(false)
  const [hasToken, setHasToken] = useState(() => readToken() !== '')
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.getHealth()
      .then((health) => { if (!cancelled) setTokenProtected(health.operatorTokenProtected) })
      .catch(() => {
        // Health is unauthenticated, so a failure here means the API
        // itself isn't reachable — not something a token banner can fix.
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    function onAuthError() {
      setAuthError(true)
      setDismissed(false)
    }
    function onStorage() {
      setHasToken(readToken() !== '')
    }
    window.addEventListener('ductum:auth-error', onAuthError as EventListener)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('ductum:auth-error', onAuthError as EventListener)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const visible = !dismissed && tokenProtected && (!hasToken || authError)
  if (!visible) return null

  async function autodetect() {
    setDetecting(true)
    setError(null)
    try {
      const result = await api.detectOperatorToken()
      if (!result.ok || result.token == null) {
        setError(result.reason ?? 'Auto-detect unavailable')
        return
      }
      globalThis.localStorage?.setItem(STORAGE_KEY, result.token)
      setHasToken(true)
      setAuthError(false)
      // Reload so every active query refetches with the new header.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-detect failed')
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
          Connect API access
        </Mono>
        <Mono size={11} color={tokens.dim}>
          Local <code>ductum start</code> opens a short-lived browser handoff
          when it can. If this browser was opened manually, save API access for
          this browser, or use Auto-detect when the local API was started with
          explicit opt-in.
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
          Open API access
        </a>
        <Btn
          data-testid="token-banner-autodetect"
          onClick={autodetect}
          disabled={detecting}
        >
          {detecting ? 'Detecting…' : 'Auto-detect'}
        </Btn>
        <Btn onClick={() => setDismissed(true)}>Dismiss</Btn>
      </div>
    </div>
  )
}

function readToken(): string {
  return globalThis.localStorage?.getItem(STORAGE_KEY)?.trim() ?? ''
}

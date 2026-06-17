import { useEffect, useState } from 'react'

import { api } from '@/api/client'
import { Btn, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import { Field, fieldStyle } from '@/settings/controls'

const STORAGE_KEY = 'ductum.operatorToken'

type VerifyState = { kind: 'idle' } | { kind: 'verifying' } | { kind: 'pass' } | { kind: 'fail'; reason: string }

export function DashboardAccessPanel({ onSaved, onCleared }: { onSaved?: () => void; onCleared?: () => void } = {}) {
  const [token, setToken] = useState('')
  const [saved, setSaved] = useState(false)
  const [verify, setVerify] = useState<VerifyState>({ kind: 'idle' })

  useEffect(() => {
    const existing = globalThis.localStorage?.getItem(STORAGE_KEY) ?? ''
    setToken(existing)
    setSaved(existing.trim() !== '')
  }, [])

  function save() {
    const trimmed = token.trim()
    if (trimmed === '') {
      globalThis.localStorage?.removeItem(STORAGE_KEY)
      setToken('')
      setSaved(false)
      setVerify({ kind: 'idle' })
      return
    }
    globalThis.localStorage?.setItem(STORAGE_KEY, trimmed)
    setToken(trimmed)
    setSaved(true)
    setVerify({ kind: 'idle' })
    onSaved?.()
  }

  function clear() {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
    setToken('')
    setSaved(false)
    setVerify({ kind: 'idle' })
    onCleared?.()
  }

  async function verifyToken() {
    setVerify({ kind: 'verifying' })
    try {
      await api.getFactory()
      setVerify({ kind: 'pass' })
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'verification failed'
      setVerify({ kind: 'fail', reason })
    }
  }

  async function autodetect() {
    setVerify({ kind: 'verifying' })
    try {
      const result = await api.detectOperatorToken()
      if (!result.ok || result.token == null) {
        setVerify({ kind: 'fail', reason: result.reason ?? 'Auto-detect unavailable' })
        return
      }
      globalThis.localStorage?.setItem(STORAGE_KEY, result.token)
      setToken(result.token)
      setSaved(true)
      setVerify({ kind: 'pass' })
      onSaved?.()
    } catch (err) {
      setVerify({ kind: 'fail', reason: err instanceof Error ? err.message : 'Auto-detect failed' })
    }
  }

  return (
    <div id="api-access">
      <Card>
        <CardHeader title="API access" meta={saved ? 'token saved in this browser' : 'browser not connected'} />
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Dot color={saved ? tokens.ok : tokens.mid} pulse={saved} />
            <span
              data-testid="operator-token-status"
              style={{
                fontFamily: tokens.mono,
                fontSize: 12,
                color: saved ? tokens.ok : tokens.mid,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {saved ? 'Connected' : 'Needs token'}
            </span>
          </div>
          <Field label="operator token" hint="Paste the operator token from the local token file, or use Auto-detect when this API process explicitly allows it. Stored only in this browser and sent as X-Ductum-Operator-Token for protected actions.">
            <input
              data-testid="operator-token-input"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              style={fieldStyle}
              autoComplete="off"
            />
          </Field>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
            {verify.kind === 'pass' && (
              <Mono size={11} color={tokens.ok} data-testid="operator-token-verify-result">verified</Mono>
            )}
            {verify.kind === 'fail' && (
              <Mono size={11} color={tokens.err} data-testid="operator-token-verify-result">{verify.reason}</Mono>
            )}
            {verify.kind === 'verifying' && (
              <Mono size={11} color={tokens.dim} data-testid="operator-token-verify-result">verifying…</Mono>
            )}
            <Btn
              data-testid="operator-token-verify"
              onClick={verifyToken}
              disabled={verify.kind === 'verifying'}
            >
              Verify token
            </Btn>
            <Btn
              data-testid="operator-token-autodetect"
              onClick={autodetect}
              disabled={verify.kind === 'verifying'}
            >
              Auto-detect
            </Btn>
            <Btn onClick={clear}>Clear</Btn>
            <Btn primary onClick={save}>Save token</Btn>
          </div>
        </div>
      </Card>
    </div>
  )
}

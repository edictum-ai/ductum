import { useEffect, useRef } from 'react'

import { api } from '@/api/client'

const LEGACY_STORAGE_KEY = 'ductum.operatorToken'

/**
 * Repairs expired local browser sessions without surfacing operator-token UX.
 * If repair fails, the page-level empty/error state tells the operator to open
 * the dashboard from the CLI again.
 */
export function TokenBanner() {
  const reconnecting = useRef(false)
  const attempted = useRef(false)

  useEffect(() => {
    function onAuthError() {
      void reconnect()
    }
    window.addEventListener('ductum:auth-error', onAuthError as EventListener)
    return () => {
      window.removeEventListener('ductum:auth-error', onAuthError as EventListener)
    }
  }, [])

  async function reconnect() {
    if (reconnecting.current || attempted.current) return
    attempted.current = true
    reconnecting.current = true
    try {
      const result = await api.reconnectBrowserSession()
      if (!result.ok) return
      globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY)
      window.location.reload()
    } catch (err) {
      // Page-level query errors render the fallback. Do not expose auth details.
    } finally {
      reconnecting.current = false
    }
  }

  return null
}

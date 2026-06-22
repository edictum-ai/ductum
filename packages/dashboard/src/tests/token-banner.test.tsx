import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenBanner } from '@/components/TokenBanner'
import { mockFetch } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  fetchHelper?.restore()
  vi.restoreAllMocks()
})

describe('TokenBanner', () => {
  it('repairs auth failures without showing token or session UX', async () => {
    fetchHelper = mockFetch({
      'POST /api/internal/session/reconnect': { ok: true },
    })
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    })

    render(<TokenBanner />)

    act(() => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
    })

    await waitFor(() => {
      expect(fetchHelper.mock).toHaveBeenCalledWith(
        expect.stringContaining('/api/internal/session/reconnect'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(reload).toHaveBeenCalled()
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/token|session settings|try reconnect/i)
  })

  it('stays invisible when reconnect is unavailable', async () => {
    fetchHelper = mockFetch({
      'POST /api/internal/session/reconnect': {
        __status: 403,
        body: { ok: false, reason: 'Local reconnect requires explicit server opt-in' },
      },
    })

    render(<TokenBanner />)

    await act(async () => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
    })

    await waitFor(() => {
      expect(fetchHelper.mock).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/operator token|browser session|local reconnect/i)
  })

  it('does not retry repeatedly after the first failed repair', async () => {
    fetchHelper = mockFetch({
      'POST /api/internal/session/reconnect': {
        __status: 403,
        body: { ok: false, reason: 'Local reconnect requires explicit server opt-in' },
      },
    })

    render(<TokenBanner />)

    act(() => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/projects' } }))
    })

    await waitFor(() => {
      expect(fetchHelper.mock).toHaveBeenCalledTimes(1)
    })
  })
})

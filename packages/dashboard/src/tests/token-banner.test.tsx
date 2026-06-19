import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenBanner } from '@/components/TokenBanner'
import { mockFetch } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

beforeEach(() => {
  globalThis.localStorage.clear()
})

afterEach(() => {
  fetchHelper?.restore()
})

describe('TokenBanner', () => {
  it('waits for a real auth failure before showing', async () => {
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
    })

    render(<TokenBanner />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
    })

    expect(await screen.findByTestId('token-banner')).toBeInTheDocument()
    expect(screen.getByText('Reconnect dashboard')).toBeInTheDocument()
    expect(screen.getByText(/authenticated browser session/i)).toBeInTheDocument()
    expect(screen.getByText(/opened without that handoff/i)).toBeInTheDocument()
    expect(screen.getByTestId('token-banner-settings')).toHaveAttribute('href', '/settings#api-access')
    expect(screen.getByTestId('token-banner-settings')).toHaveTextContent('Session settings')
    expect(screen.getByTestId('token-banner-autodetect')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('detected-secret')
  })

  it('stays hidden when API does not require a token', async () => {
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: false },
    })

    render(<TokenBanner />)

    // Wait until the health check has resolved.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()
  })

  it('appears after a 401 even when a token is saved', async () => {
    globalThis.localStorage.setItem('ductum.operatorToken', 'stale-token')
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
    })

    render(<TokenBanner />)

    // Initially hidden because the token is set.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
    })

    expect(await screen.findByTestId('token-banner')).toBeInTheDocument()
  })

  it('local reconnect opens a browser session and reloads', async () => {
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
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
    const button = await screen.findByTestId('token-banner-autodetect')
    fireEvent.click(button)

    await waitFor(() => {
      expect(globalThis.localStorage.getItem('ductum.operatorToken')).toBeNull()
    })
    expect(fetchHelper.mock).toHaveBeenCalledWith(
      expect.stringContaining('/api/internal/session/reconnect'),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(reload).toHaveBeenCalled()
  })

  it('shows the reconnect failure reason when explicit opt-in is missing', async () => {
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
      'POST /api/internal/session/reconnect': {
        __status: 403,
        body: { ok: false, reason: 'Local reconnect requires explicit server opt-in' },
      },
    })

    render(<TokenBanner />)

    act(() => {
      window.dispatchEvent(new CustomEvent('ductum:auth-error', { detail: { path: '/factory' } }))
    })
    fireEvent.click(await screen.findByTestId('token-banner-autodetect'))

    expect(await screen.findByText(/explicit server opt-in/i)).toBeInTheDocument()
  })
})

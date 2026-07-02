import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import { currentOperatorSessionFixture, factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings API access', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders session controls without a token-entry field', async () => {
    fetchHelper = mockFetch(typedSettingsMocks())

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Dashboard session')).toBeInTheDocument()
    expect(screen.getByTestId('operator-session-status')).toHaveTextContent('Browser session not checked')
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()
    expect(screen.queryByText('Save manual access')).not.toBeInTheDocument()
  })

  it('reconnects from Settings without exposing or storing browser credentials', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/internal/session/reconnect': { ok: true },
    }))

    renderWithProviders(<Settings />)

    await screen.findByTestId('operator-session-reconnect')
    fireEvent.click(screen.getByTestId('operator-session-reconnect'))

    await waitFor(() => {
      expect(screen.getByTestId('operator-session-status')).toHaveTextContent('Session connected')
    })
    expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
    expect(callsOf(fetchHelper, 'POST', '/api/internal/session/reconnect')).toHaveLength(1)
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'GET', '/api/factory-settings').length).toBeGreaterThan(1)
    })
    expect(document.body).not.toHaveTextContent('detected-secret')
  })

  it('connects from Settings with a one-time browser link', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/internal/welcome/exchange': {
        schemaVersion: 1,
        kind: 'welcome.handoff_exchanged',
        data: { ok: true, factoryId: 'factory-1', expiresAt: '2026-06-19T12:00:00.000Z' },
        ts: '2026-06-19T12:00:00.000Z',
      },
    }))

    renderWithProviders(<Settings />)

    fireEvent.change(await screen.findByTestId('dashboard-pairing-code'), {
      target: { value: 'http://127.0.0.1:4173/welcome?pair=pair-code' },
    })
    fireEvent.click(screen.getByTestId('dashboard-pairing-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('operator-session-status')).toHaveTextContent('Session connected')
    })
    expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
    const calls = callsOf(fetchHelper, 'POST', '/api/internal/welcome/exchange')
    expect(calls).toHaveLength(1)
    expect(requestBody(calls[0]!)).toEqual({ token: 'pair-code' })
  })

  it('shows session reconnect instead of raw JSON when Settings is protected', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': { __status: 401, body: { error: 'Operator token required' } },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Reconnect dashboard')).toBeInTheDocument()
    expect(screen.getByText('Dashboard session')).toBeInTheDocument()
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()
    expect(screen.getByText('Browser session required')).toBeInTheDocument()
    expect(screen.queryByText('Operator token required')).not.toBeInTheDocument()
  })

  it('shows current scope and locks settings writes for read-only sessions', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/operator/session': currentOperatorSessionFixture({
        actor: 'auditor',
        scopes: ['read'],
      }),
    }))

    renderWithProviders(<Settings />)

    expect(await screen.findByTestId('operator-session-current')).toHaveTextContent('auditor · read')
    expect(screen.getByText('Settings locked')).toBeInTheDocument()
    expect(screen.queryByTestId('runtime-settings-save')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Agents' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Secrets' })).not.toBeInTheDocument()
    expect(callsOf(fetchHelper, 'GET', '/api/operator/sessions')).toHaveLength(0)
  })

  it('keeps API access reachable for protected Settings even when the 401 text changes', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': { __status: 401, body: { error: 'Unauthorized' } },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Reconnect dashboard')).toBeInTheDocument()
    expect(screen.getByText('Dashboard session')).toBeInTheDocument()
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()
    expect(screen.getByText('Browser session required')).toBeInTheDocument()
    expect(screen.queryByText('Unauthorized')).not.toBeInTheDocument()
  })

  it('reconnects from the protected Settings gate without manual copy-paste', async () => {
    let connected = false
    fetchHelper = mockFetch({
      '/api/factory-settings': () => (connected
        ? factorySettingsFixture()
        : { __status: 401, body: { error: 'Operator token required' } }),
      'POST /api/internal/session/reconnect': () => {
        connected = true
        return { ok: true }
      },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Reconnect dashboard')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('operator-session-reconnect'))

    await waitFor(() => {
      expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
      expect(screen.queryByText('API access required')).not.toBeInTheDocument()
    })
  })

  it('clears old browser-stored access without showing token management', async () => {
    localStorage.setItem('ductum.operatorToken', 'legacy-secret')
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/internal/session/logout': { ok: true },
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
    })
    expect(await screen.findByTestId('operator-session-status')).toHaveTextContent('Browser session not checked')
    expect(document.body).not.toHaveTextContent('legacy')
    fireEvent.click(screen.getByText('Clear browser access'))

    await waitFor(() => {
      expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
    })
    expect(callsOf(fetchHelper, 'POST', '/api/internal/session/logout')).toHaveLength(1)
  })
})

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

function fetchedPaths() {
  return fetchHelper.mock.mock.calls.map(([url]) => String(url))
}

describe('Settings API access', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('stores the operator API token for protected deployments', async () => {
    fetchHelper = mockFetch(typedSettingsMocks())

    renderWithProviders(<Settings />)

    const input = await screen.findByTestId('operator-token-input')
    fireEvent.change(input, { target: { value: 'demo-token' } })
    fireEvent.click(screen.getByText('Save token'))

    expect(localStorage.getItem('ductum.operatorToken')).toBe('demo-token')
    expect(screen.getByTestId('operator-token-status')).toHaveTextContent('Connected')
  })

  it('auto-detects the operator API token from Settings when the local API allows it', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/internal/operator-token-detect': { ok: true, token: 'detected-secret' },
    }))

    renderWithProviders(<Settings />)

    await screen.findByTestId('operator-token-autodetect')
    fireEvent.click(screen.getByTestId('operator-token-autodetect'))

    await waitFor(() => {
      expect(localStorage.getItem('ductum.operatorToken')).toBe('detected-secret')
    })
    expect(screen.getByTestId('operator-token-input')).toHaveValue('detected-secret')
    expect(screen.getByTestId('operator-token-status')).toHaveTextContent('Connected')
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'GET', '/api/factory-settings').length).toBeGreaterThan(1)
    })
    expect(document.body).not.toHaveTextContent('detected-secret')
  })

  it('shows a real token panel instead of raw JSON when Settings is protected', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': { __status: 401, body: { error: 'Operator token required' } },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Connect API access')).toBeInTheDocument()
    expect(screen.getByTestId('operator-token-input')).toBeInTheDocument()
    expect(screen.getByText('Operator token required')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('operator-token-input'), { target: { value: 'demo-token' } })
    fireEvent.click(screen.getByText('Save token'))

    expect(localStorage.getItem('ductum.operatorToken')).toBe('demo-token')
    await waitFor(() => {
      expect(fetchedPaths().filter((url) => url.includes('/api/factory-settings')).length).toBeGreaterThan(1)
    })
  })

  it('keeps API access reachable for protected Settings even when the 401 text changes', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': { __status: 401, body: { error: 'Unauthorized' } },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Connect API access')).toBeInTheDocument()
    expect(screen.getByTestId('operator-token-input')).toBeInTheDocument()
    expect(screen.getByText('Unauthorized')).toBeInTheDocument()
  })

  it('auto-detects from the protected Settings gate without manual copy-paste', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': ({ init }: { url: string; init?: RequestInit }) => (
        (init?.headers as Record<string, string> | undefined)?.['X-Ductum-Operator-Token'] === 'detected-secret'
          ? factorySettingsFixture()
          : { __status: 401, body: { error: 'Operator token required' } }
      ),
      '/api/internal/operator-token-detect': { ok: true, token: 'detected-secret' },
    })

    renderWithProviders(<Settings />)

    expect(await screen.findByText('Connect API access')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('operator-token-autodetect'))

    await waitFor(() => {
      expect(localStorage.getItem('ductum.operatorToken')).toBe('detected-secret')
      expect(screen.queryByText('API access required')).not.toBeInTheDocument()
    })
  })
})

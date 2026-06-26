import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders, callsOf, requestBody } from './test-utils'
import { factorySettingsDetailsFixture, typedSettingsMocks, writeResultFixture } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings write status', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('reports a factory write as restart-required instead of applied', async () => {
    const details = factorySettingsDetailsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      'PATCH /api/factory/settings': writeResultFixture(
        details,
        { ...details, heartbeatTimeoutSeconds: 240 },
        { applied: false, restartRequired: true, affectedRuntimes: ['dispatcher'] },
      ),
    }))

    renderWithProviders(<Settings />)

    const heartbeat = await screen.findByRole('textbox', { name: 'heartbeat timeout (s)' })
    fireEvent.change(heartbeat, { target: { value: '240' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save factory settings' }))

    await waitFor(() => {
      expect(screen.getByTestId('factory-settings-status')).toHaveTextContent('restart required → dispatcher')
    })
    expect(screen.getByTestId('factory-settings-status')).not.toHaveTextContent('saved · applied')

    const patchCalls = callsOf(fetchHelper, 'PATCH', '/api/factory/settings')
    expect(patchCalls).toHaveLength(1)
    expect(requestBody(patchCalls[0] as [RequestInfo, RequestInit])).toEqual({ heartbeatTimeoutSeconds: 240 })
  })
})

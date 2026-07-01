import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import {
  factoryRuntimeFixture,
  typedSettingsMocks,
  writeResultFixture,
} from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings runtime panel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('reports a runtime write as restart-required instead of applied', async () => {
    const runtime = factoryRuntimeFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      'PATCH /api/factory/runtime': writeResultFixture(
        runtime.current,
        { ...runtime.desired, dispatcherHeartbeatIntervalSeconds: 30 },
        { applied: false, restartRequired: true, affectedRuntimes: ['dispatcher'] },
      ),
    }))

    renderWithProviders(<Settings />)

    const interval = await screen.findByRole('textbox', { name: 'heartbeat interval (s) desired value' })
    fireEvent.change(interval, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save runtime settings' }))

    await waitFor(() => {
      expect(screen.getByTestId('runtime-settings-status')).toHaveTextContent('restart required → dispatcher')
    })
    expect(screen.getByTestId('runtime-settings-status')).not.toHaveTextContent('saved · applied')

    const patchCalls = callsOf(fetchHelper, 'PATCH', '/api/factory/runtime')
    expect(patchCalls).toHaveLength(1)
    expect(requestBody(patchCalls[0] as [RequestInfo, RequestInit])).toEqual({ dispatcherHeartbeatIntervalSeconds: 30 })
  })

  it('cycles the dispatcher from Runtime settings', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/factory/dispatcher/cycle': {
        tasksEvaluated: 3,
        tasksDispatched: ['task_1', 'task_2'],
        errors: [],
      },
    }))

    renderWithProviders(<Settings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Cycle dispatcher' }))

    await waitFor(() => {
      expect(screen.getByTestId('runtime-dispatcher-cycle-status')).toHaveTextContent('dispatcher cycle complete · evaluated 3 · dispatched 2')
    })
    expect(callsOf(fetchHelper, 'POST', '/api/factory/dispatcher/cycle')).toHaveLength(1)
  })

  it('marks persisted desired values that the process has not applied yet', async () => {
    const runtime = factoryRuntimeFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/factory/runtime': {
        ...runtime,
        desired: { ...runtime.desired, apiPort: 4200 },
        restartRequired: true,
        affectedRuntimes: ['api'],
      },
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByTestId('runtime-restart-banner')).toHaveTextContent('restart Ductum API → api')
    })
    expect(screen.getByTestId('runtime-current-apiPort')).toHaveTextContent('4100')
    expect(screen.getByTestId('runtime-desired-apiPort')).toHaveValue('4200')
    expect(screen.getByTestId('runtime-pending-apiPort')).toHaveTextContent('restart')
  })
})

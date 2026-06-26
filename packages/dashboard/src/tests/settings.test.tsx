import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { tokens } from '@/components/signal'
import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import {
  factoryRuntimeFixture,
  factorySettingsDetailsFixture,
  factorySettingsFixture,
  typedSettingsMocks,
  writeResultFixture,
} from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

function fetchedPaths() {
  return fetchHelper.mock.mock.calls.map(([url]) => String(url))
}

describe('Settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders every typed panel from typed APIs and never touches YAML routes', async () => {
    fetchHelper = mockFetch(typedSettingsMocks())

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory configuration' })).toBeInTheDocument()
    })

    expect(screen.getByText('Dashboard session')).toBeInTheDocument()
    expect(screen.queryByTestId('operator-token-input')).not.toBeInTheDocument()

    // Factory panel renders the typed details as editable fields.
    expect(await screen.findByTestId('factory-name-input')).toHaveValue('Ductum')
    expect(screen.getByTestId('factory-merge-mode')).toHaveValue('human')
    expect(screen.getByTestId('factory-heartbeat-input')).toHaveValue('120')
    expect(screen.getByTestId('factory-budget-hard')).toHaveValue('10')

    // Runtime panel separates current process facts from desired values.
    await waitFor(() => {
      expect(screen.getByTestId('runtime-current-apiPort')).toHaveTextContent('4100')
    })
    expect(screen.getByTestId('runtime-desired-apiPort')).toHaveValue('')
    expect(screen.getByText('/factory/.ductum/factory.db')).toBeInTheDocument()

    // Secrets render metadata only.
    const secretRow = await screen.findByTestId('secret-row-anthropic-api-key')
    expect(within(secretRow).getByText('configured')).toBeInTheDocument()

    // Typed catalogs render live DB records.
    expect(screen.getByTestId('factory-settings-summary')).toBeInTheDocument()
    expect(screen.getByTestId('factory-agent-Atlas')).toBeInTheDocument()
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Model: claude-sonnet-4-6')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Harness: claude-agent-sdk')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('model_sonnet')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('harness_claude')
    expect(screen.getByTestId('agent-settings-Atlas')).toBeInTheDocument()
    expect(screen.getByTestId('agent-model-ref-Atlas')).toHaveTextContent('Model ID: claude-sonnet-4-6')
    expect(screen.getByTestId('agent-model-ref-Atlas')).toHaveTextContent('provider model ID: claude-sonnet-4-6')
    expect(screen.getByTestId('agent-harness-ref-Atlas')).toHaveTextContent('Harness ID: claude-agent-sdk')
    expect(screen.getByTestId('agent-harness-ref-Atlas')).toHaveTextContent('adapter type: claude-agent-sdk')
    expect(screen.queryByText('Select modelRef')).toBeNull()
    expect(screen.queryByText('Select harnessRef')).toBeNull()
    expect(screen.getByText('builder · xhigh')).toBeInTheDocument()

    // No YAML editing surface remains anywhere.
    expect(screen.queryByTestId('settings-yaml')).toBeNull()
    expect(screen.queryByText(/Advanced catalogs and YAML/)).toBeNull()
    expect(screen.queryByText(/Config file:/)).toBeNull()
    expect(screen.queryByText(/ductum\.yaml/)).toBeNull()

    // The legacy YAML Settings route is never fetched.
    expect(fetchedPaths().some((url) => url.includes('/api/settings/config'))).toBe(false)
  })

  it('shows DB-backed summary counts even when legacy receipt debug metadata disagrees', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        debug: { legacyReceipt: { path: '/tmp/legacy/receipt.yaml', counts: { projects: 0, agents: 0, models: 0 } } },
      }),
    }))

    renderWithProviders(<Settings />)

    expect(await screen.findByTestId('factory-settings-tile-agents')).toHaveTextContent('1')
    expect(screen.getByTestId('factory-settings-tile-models')).toHaveTextContent('2')
    expect(screen.queryByText('/tmp/legacy/receipt.yaml')).toBeNull()
  })

  it('keeps existing agent model and harness refs visible when catalog options are missing', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: [],
        harnesses: [],
        agents: [{
          ...atlas,
          modelRef: 'gpt-5.4',
          modelId: 'gpt-5.4',
          providerModelId: 'gpt-5.4',
          harnessRef: 'codex-sdk',
          harnessId: 'codex-sdk',
          harnessType: 'codex-sdk',
          resourceRefs: { ...atlas.resourceRefs, modelRef: 'gpt-5.4', harnessRef: 'codex-sdk' },
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    const model = await screen.findByTestId('agent-model-ref-Atlas')
    const harness = await screen.findByTestId('agent-harness-ref-Atlas')
    expect(model).toHaveTextContent('gpt-5.4 (current, not in catalog)')
    expect(harness).toHaveTextContent('codex-sdk (current, not in catalog)')
    expect(model).not.toHaveTextContent('Select modelRef')
    expect(harness).not.toHaveTextContent('Select harnessRef')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Model: gpt-5.4')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Harness: codex-sdk')
  })

  it('shows resolved agent model and harness identity when refs are absent and catalogs are empty', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: [],
        harnesses: [],
        agents: [{
          ...atlas,
          modelRef: undefined,
          modelId: 'gpt-5.4',
          providerModelId: 'gpt-5.4',
          harnessRef: undefined,
          harnessId: 'codex-sdk',
          harnessType: 'codex-sdk',
          resourceRefs: { sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    const model = await screen.findByTestId('agent-model-ref-Atlas')
    const harness = await screen.findByTestId('agent-harness-ref-Atlas')
    expect(model).toHaveDisplayValue('gpt-5.4 (current, not in catalog)')
    expect(harness).toHaveDisplayValue('codex-sdk (current, not in catalog)')
    expect(model).not.toHaveDisplayValue('Select model')
    expect(harness).not.toHaveDisplayValue('Select harness')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Model: gpt-5.4')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Harness: codex-sdk')
  })

  it('saves factory settings through PATCH /api/factory/settings and refetches typed keys', async () => {
    const details = factorySettingsDetailsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      'PATCH /api/factory/settings': writeResultFixture(details, { ...details, heartbeatTimeoutSeconds: 240 }),
    }))

    renderWithProviders(<Settings />)

    const heartbeat = await screen.findByTestId('factory-heartbeat-input')
    fireEvent.change(heartbeat, { target: { value: '240' } })
    fireEvent.click(screen.getByTestId('factory-settings-save'))

    await waitFor(() => {
      expect(screen.getByTestId('factory-settings-status')).toHaveTextContent('saved · applied')
    })

    const patchCalls = callsOf(fetchHelper, 'PATCH', '/api/factory/settings')
    expect(patchCalls).toHaveLength(1)
    expect(requestBody(patchCalls[0] as [RequestInfo, RequestInit])).toEqual({ heartbeatTimeoutSeconds: 240 })

    // Invalidation refetches the typed reads, not any YAML route.
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'GET', '/api/factory/settings').length).toBeGreaterThan(1)
      expect(callsOf(fetchHelper, 'GET', '/api/factory-settings').length).toBeGreaterThan(1)
    })
    expect(fetchedPaths().some((url) => url.includes('/api/settings/config'))).toBe(false)
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

    const interval = await screen.findByTestId('runtime-desired-dispatcherHeartbeatIntervalSeconds')
    fireEvent.change(interval, { target: { value: '30' } })
    fireEvent.click(screen.getByTestId('runtime-settings-save'))

    await waitFor(() => {
      expect(screen.getByTestId('runtime-settings-status')).toHaveTextContent('restart required → dispatcher')
    })
    expect(screen.getByTestId('runtime-settings-status')).not.toHaveTextContent('saved · applied')

    const patchCalls = callsOf(fetchHelper, 'PATCH', '/api/factory/runtime')
    expect(patchCalls).toHaveLength(1)
    expect(requestBody(patchCalls[0] as [RequestInfo, RequestInit])).toEqual({ dispatcherHeartbeatIntervalSeconds: 30 })
  })

  it('saves Agent routing through resource refs, not raw model or harness strings', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const modelRef = await screen.findByTestId('agent-model-ref-Atlas')
    fireEvent.change(modelRef, { target: { value: 'model_gpt' } })
    fireEvent.click(within(screen.getByTestId('agent-settings-Atlas')).getByText('Save'))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])).toEqual({
      resourceRefs: {
        modelRef: 'model_gpt',
        harnessRef: 'harness_claude',
        sandboxRef: 'sandbox_builder',
        workflowProfileRef: 'wf_guard',
      },
      costTier: 70,
    })
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
      expect(screen.getByTestId('runtime-restart-banner')).toHaveTextContent('restart required → api')
    })
    expect(screen.getByTestId('runtime-current-apiPort')).toHaveTextContent('4100')
    expect(screen.getByTestId('runtime-desired-apiPort')).toHaveValue('4200')
    expect(screen.getByTestId('runtime-pending-apiPort')).toHaveTextContent('restart')
  })

  it('renders honest empty catalogs without crashing', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        agents: [],
        providers: [],
        models: [],
        harnesses: [],
        workflows: [],
        sandboxProfiles: [],
        notificationChannels: [],
      }),
      'GET /api/factory/secrets': [],
      'GET /api/resources/NotificationChannel': [],
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getAllByText('No agents registered').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('No models')).toBeInTheDocument()
    expect(within(screen.getByTestId('factory-settings-tile-models')).getByText('0')).toHaveStyle({ color: tokens.warn })
    expect(screen.getAllByText(/Read-only in browser. Create or change these records with the Ductum CLI/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Approval channels cannot be added here yet/)).toBeNull()
    expect(screen.getByText('Add Telegram channel')).toBeInTheDocument()
    expect(await screen.findByText('No secrets stored')).toBeInTheDocument()
    expect(fetchedPaths().some((url) => url.includes('/api/settings/config'))).toBe(false)
  })

})

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

// Secret-shaped values the public redaction layer must strip before the
// read-only Factory Settings overview renders API data.
const SECRETS = [
  'sk-ant-api03-test-secret',
  'sk-proj-test-secret',
  'ghp_testsecret',
  'xoxb-test-secret',
  '123456:telegram-secret',
  'Bearer test-secret',
  'postgres://user:password@example.com/db',
  'webhook-secret-value',
]

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings public redaction', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('does not render raw secret-bearing values returned by /api/factory-settings', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': secretFactorySettings(),
    })

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByTestId('factory-settings-summary')).toBeInTheDocument()
    })

    const formValues = Array.from(document.querySelectorAll('input, textarea'))
      .map((element) => (element as HTMLInputElement | HTMLTextAreaElement).value)
      .join('\n')
    const rendered = `${document.body.textContent ?? ''}\n${formValues}`
    for (const secret of SECRETS) expect(rendered).not.toContain(secret)
    expect(rendered).toContain('[redacted]')
  })

  it('scopes secret access refs to the agent that owns them', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    const codex: typeof atlas = {
      ...atlas,
      id: 'agent_codex',
      name: 'Codex',
      role: 'builder',
      modelRef: 'model_gpt',
      modelId: 'gpt-5.4',
      providerModelId: 'gpt-5.4',
      harnessRef: 'harness_claude',
      harnessId: 'claude-agent-sdk',
      harnessType: 'claude-agent-sdk',
      secretAccessRefs: ['secret:openai-api-key'],
      resourceRefs: { modelRef: 'model_gpt', harnessRef: 'harness_claude', sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
    }
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        agents: [
          { ...atlas, secretAccessRefs: ['secret:anthropic-api-key'] },
          codex,
        ],
      }),
    }))

    renderWithProviders(<Settings />)

    await screen.findByTestId('agent-settings-Codex')

    // Each agent's row exposes only its own secretAccessRefs; a global
    // leak would surface the other agent's provider secret in the wrong row.
    const atlasRow = within(screen.getByTestId('agent-settings-Atlas'))
    const codexRow = within(screen.getByTestId('agent-settings-Codex'))
    expect(atlasRow.getByText(/secret access refs:/)).toHaveTextContent('secret:anthropic-api-key')
    expect(atlasRow.queryByText(/openai-api-key/)).toBeNull()
    expect(codexRow.getByText(/secret access refs:/)).toHaveTextContent('secret:openai-api-key')
    expect(codexRow.queryByText(/anthropic-api-key/)).toBeNull()
  })
})

function secretFactorySettings() {
  return factorySettingsFixture({
    models: [
      {
        recordType: 'Model',
        id: 'model_x',
        name: 'leaky-model',
        scope: 'factory',
        projectId: null,
        modelId: 'leaky-model',
        providerId: 'sk-proj-test-secret',
        providerModelId: 'sk-ant-api03-test-secret',
        source: 'saved',
      },
    ],
    harnesses: [
      {
        recordType: 'Harness',
        id: 'harness_x',
        name: 'leaky-harness',
        scope: 'factory',
        projectId: null,
        harnessId: 'leaky-harness',
        adapterType: 'ghp_testsecret',
        controlMode: 'Bearer test-secret',
        source: 'saved',
      },
    ],
    sandboxProfiles: [
      {
        recordType: 'SandboxProfile',
        id: 'sandbox_x',
        name: 'leaky-sandbox',
        scope: 'factory',
        projectId: null,
        sandboxProfileId: 'leaky-sandbox',
        provider: 'postgres://user:password@example.com/db',
        mode: 'webhook-secret-value',
        source: 'saved',
      },
    ],
    notificationChannels: [
      {
        recordType: 'NotificationChannel',
        id: 'channel_x',
        name: 'leaky-channel',
        scope: 'factory',
        projectId: null,
        notificationChannelId: 'leaky-channel',
        backend: '123456:telegram-secret',
        configured: false,
        source: 'saved',
      },
    ],
    agents: [
      {
        recordType: 'Agent',
        id: 'agent_x',
        name: 'leaky-agent',
        scope: 'factory',
        projectId: null,
        role: 'builder',
        modelRef: 'model_x',
        modelId: 'xoxb-test-secret',
        providerId: 'openai',
        providerModelId: 'xoxb-test-secret',
        harnessRef: 'harness_x',
        harnessId: 'leaky-harness',
        harnessType: 'leaky-harness',
        enabled: true,
        secretAccessRefs: [],
        resourceRefs: { modelRef: 'model_x', harnessRef: 'harness_x' },
        settings: { capabilities: ['build'], effort: null, costTier: 1, spawnConfig: {} },
        source: 'saved',
      },
    ],
  })
}

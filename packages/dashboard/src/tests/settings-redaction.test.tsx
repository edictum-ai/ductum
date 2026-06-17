import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import { factorySettingsFixture } from './settings-fixtures'

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

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

// Provider-specific env / credential field *labels* that must never appear
// UNCONDITIONALLY on the Settings page. If a future panel ever grows
// provider-env inputs, it must be gated by the active provider; rendering
// them blindly leaks provider requirements across GLM/Codex/Claude agents.
// We do not match secret names (operators legitimately store keys here with
// arbitrary names); only input labels and aria-labels would represent a
// hard-coded per-provider field that breaks isolation.
const PROVIDER_ENV_LABEL_PATTERNS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GLM_API_KEY',
  'ZHIPU_API_KEY',
  'Z_AI_API_KEY',
  'CODEX_API_KEY',
  'CLAUDE_API_KEY',
  'anthropic api key',
  'openai api key',
  'glm api key',
  'codex api key',
  'claude api key',
  'zhipu api key',
  'anthropic base url',
  'openai base url',
  'glm base url',
  'codex base url',
]

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings provider field isolation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('does not expose provider-specific env or credential fields in any panel', async () => {
    // Build a fixture that includes agents and secrets backed by every
    // provider we ship. If any Settings panel ever grows provider-env
    // inputs, those fields must be conditional on the active provider;
    // surfacing them here would fail this assertion.
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        providers: [
          { recordType: 'Provider', id: 'prov_anthropic', name: 'Anthropic', scope: 'factory', projectId: null, providerId: 'anthropic', label: 'Anthropic', modelCount: 1, source: 'built-in' },
          { recordType: 'Provider', id: 'prov_openai', name: 'OpenAI', scope: 'factory', projectId: null, providerId: 'openai', label: 'OpenAI', modelCount: 1, source: 'built-in' },
          { recordType: 'Provider', id: 'prov_glm', name: 'GLM', scope: 'factory', projectId: null, providerId: 'glm', label: 'Z.AI GLM', modelCount: 1, source: 'built-in' },
        ],
      }),
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory configuration' })).toBeInTheDocument()
    })

    // Capture every label, aria-label, and placeholder exposed to the
    // operator. Secret names are excluded (operators can name secrets
    // however they want); only hard-coded field labels would represent a
    // per-provider UI leak.
    const fieldLabels = Array.from(document.querySelectorAll('label, [aria-label], input[placeholder], textarea[placeholder], select[aria-label]'))
      .map((element) => [
        element.getAttribute('aria-label') ?? '',
        element.textContent ?? '',
        element.getAttribute('placeholder') ?? '',
      ].join('\n').toLowerCase())
      .join('\n')

    for (const pattern of PROVIDER_ENV_LABEL_PATTERNS) {
      expect(fieldLabels, `label surface leaked: ${pattern}`).not.toContain(pattern.toLowerCase())
    }
  })

  it('does not submit per-provider env or auth fields on agent routing saves', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const modelRef = await screen.findByRole('combobox', { name: 'Model' })
    fireEvent.change(modelRef, { target: { value: 'model_gpt' } })
    fireEvent.click(within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' }))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })

    const body = requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])
    // Documented agent routing payload: model (optional) + resourceRefs + costTier.
    // No provider-env, no per-provider auth/apiKey/authRef containers: those
    // belong in spawnConfig (which literal-secret validators already police)
    // or in factory secrets. A routing save from Settings must never carry
    // them inline.
    expect(Object.keys(body).sort()).toEqual(['costTier', 'resourceRefs'])
    expect(body).not.toHaveProperty('env')
    expect(body).not.toHaveProperty('apiKey')
    expect(body).not.toHaveProperty('authRef')
    expect(body).not.toHaveProperty('spawnConfig')
    expect(body).not.toHaveProperty('providerEnv')
    expect((body.resourceRefs as Record<string, unknown>).env).toBeUndefined()
  })
})

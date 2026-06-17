import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings resolved values', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('shows resolved agent model and harness identity when API refs are empty strings', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: [],
        harnesses: [],
        agents: [{
          ...atlas,
          modelRef: '',
          modelId: '',
          providerModelId: 'gpt-5.4',
          harnessRef: '',
          harnessId: '',
          harnessType: 'codex-sdk',
          resourceRefs: { modelRef: '', harnessRef: '', sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
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

  it('prefers matched catalog identities over agent fallback identities', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: [{
          ...fixture.models[0]!,
          id: 'model_catalog_match',
          name: 'catalog-model',
          modelId: 'catalog-model-id',
          providerModelId: 'catalog-provider-model-id',
        }],
        harnesses: [{
          ...fixture.harnesses[0]!,
          id: 'harness_catalog_match',
          name: 'catalog-harness',
          harnessId: 'catalog-harness-id',
          adapterType: 'catalog-adapter-type',
        }],
        agents: [{
          ...atlas,
          modelRef: 'model_catalog_match',
          modelId: 'agent-fallback-model-id',
          providerModelId: 'agent-fallback-provider-model-id',
          harnessRef: 'harness_catalog_match',
          harnessId: 'agent-fallback-harness-id',
          harnessType: 'agent-fallback-adapter-type',
          resourceRefs: { modelRef: 'model_catalog_match', harnessRef: 'harness_catalog_match', sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    expect(await screen.findByTestId('agent-model-ref-Atlas')).toHaveValue('model_catalog_match')
    expect(screen.getByTestId('agent-harness-ref-Atlas')).toHaveValue('harness_catalog_match')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Model: catalog-model-id')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Harness: catalog-harness-id')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('agent-fallback-model-id')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('agent-fallback-harness-id')
  })

  it('shows not-in-catalog state instead of raw agent refs when no resolved identity exists', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: [{
          ...fixture.models[0]!,
          id: 'model_unrelated',
          name: 'unrelated-model',
          modelId: 'wrong-model',
          providerModelId: '',
        }],
        harnesses: [{
          ...fixture.harnesses[0]!,
          id: 'harness_unrelated',
          name: 'unrelated-harness',
          harnessId: 'wrong-harness',
          adapterType: '',
        }],
        agents: [{
          ...atlas,
          modelRef: 'model_missing',
          modelId: '',
          providerModelId: '',
          harnessRef: 'harness_missing',
          harnessId: '',
          harnessType: '',
          resourceRefs: { modelRef: 'model_missing', harnessRef: 'harness_missing', sandboxRef: 'sandbox_builder', workflowProfileRef: 'wf_guard' },
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    const model = await screen.findByTestId('agent-model-ref-Atlas')
    const harness = await screen.findByTestId('agent-harness-ref-Atlas')
    expect(model).toHaveDisplayValue('Current model not in catalog')
    expect(harness).toHaveDisplayValue('Current harness not in catalog')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Model: not in catalog')
    expect(screen.getByTestId('factory-agent-Atlas')).toHaveTextContent('Harness: not in catalog')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('model_missing')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('harness_missing')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('wrong-model')
    expect(screen.getByTestId('factory-agent-Atlas')).not.toHaveTextContent('wrong-harness')
  })
})

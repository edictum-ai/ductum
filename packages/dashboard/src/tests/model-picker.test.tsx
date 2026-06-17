import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import {
  factoryRuntimeFixture,
  factorySettingsDetailsFixture,
  factorySettingsFixture,
  secretMetadataFixture,
} from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

// The Settings model panel renders from the typed model catalog
// (GET /api/factory-settings models), not from parsed config text.
// Catalog writes are still 501, so the panel must stay honestly read-only.
describe('Settings model catalog', () => {
  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders model availability from the typed catalog, including new entries', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': factorySettingsFixture({
        models: [
          { recordType: 'Model', id: 'model_sonnet', name: 'claude-sonnet-4-6', scope: 'factory', projectId: null, modelId: 'claude-sonnet-4-6', providerId: 'anthropic', providerModelId: 'claude-sonnet-4-6', source: 'saved' },
          {
            recordType: 'Model',
            id: 'model_new',
            name: 'freshly-seeded-model',
            scope: 'factory',
            projectId: null,
            modelId: 'freshly-seeded-model',
            providerId: 'openai',
            providerModelId: 'gpt-5.3-codex-spark',
            supportedEfforts: ['medium', 'high', 'xhigh'],
            supportedHarnesses: ['codex-sdk', 'codex-app-server'],
            availability: 'research-preview',
            pricingState: 'unmeasured',
            pricingNote: 'No public token pricing in OpenAI Codex docs.',
            sourceUrl: 'https://developers.openai.com/codex/models',
            lastVerifiedAt: '2026-06-12',
            source: 'built-in',
          },
        ],
      }),
      'GET /api/factory/settings': factorySettingsDetailsFixture(),
      'GET /api/factory/runtime': factoryRuntimeFixture(),
      'GET /api/factory/secrets': [secretMetadataFixture()],
    })

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByTestId('factory-models-catalog')).toBeInTheDocument()
    })

    // Name + provider model id both render; presence in the catalog is enough.
    const catalog = within(screen.getByTestId('factory-models-catalog'))
    expect(catalog.getAllByText('claude-sonnet-4-6').length).toBeGreaterThan(0)

    // A model that only exists in the typed catalog (e.g. seeded after a
    // registry refresh) renders without any config-file edit.
    const fresh = within(screen.getByTestId('factory-model-freshly-seeded-model'))
    expect(fresh.getByText('freshly-seeded-model')).toBeInTheDocument()
    expect(fresh.getByText(/Ductum model ID: freshly-seeded-model/)).toBeInTheDocument()
    expect(fresh.getByText(/provider model ID: gpt-5\.3-codex-spark/)).toBeInTheDocument()
    expect(fresh.getByText(/availability: research-preview/)).toBeInTheDocument()
    expect(fresh.getByText(/harnesses: codex-sdk\/codex-app-server/)).toBeInTheDocument()
    expect(fresh.getByText(/efforts: medium\/high\/xhigh/)).toBeInTheDocument()
    expect(fresh.getByText(/provider ID: openai/)).toBeInTheDocument()
    expect(fresh.getByText(/verified: 2026-06-12/)).toBeInTheDocument()
    expect(fresh.getByText(/source: https:\/\/developers\.openai\.com\/codex\/models/)).toBeInTheDocument()
    expect(fresh.getByText(/pricing: unmeasured/)).toBeInTheDocument()
  })

  it('does not fake editable model controls while catalog writes are unimplemented', async () => {
    fetchHelper = mockFetch({
      '/api/factory-settings': factorySettingsFixture(),
      'GET /api/factory/settings': factorySettingsDetailsFixture(),
      'GET /api/factory/runtime': factoryRuntimeFixture(),
      'GET /api/factory/secrets': [],
    })

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByTestId('factory-models-catalog')).toBeInTheDocument()
    })

    const catalog = screen.getByTestId('factory-models-catalog')
    expect(within(catalog).getByText('read-only')).toBeInTheDocument()
    expect(catalog.querySelectorAll('button, input, select, textarea')).toHaveLength(0)

    // Models never trigger writes to the 501 catalog routes on render.
    const writes = fetchHelper.mock.mock.calls.filter(([url, init]) =>
      String(url).includes('/api/factory/models') && (init?.method ?? 'GET') !== 'GET',
    )
    expect(writes).toHaveLength(0)
  })
})

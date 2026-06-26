import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings workflows', () => {
  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('renders a single coding-guard workflow when the saved profile shadows the built-in preset', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        workflows: [{
          recordType: 'Workflow',
          id: 'workflow-seeded',
          name: 'coding-guard',
          workflowId: 'coding-guard',
          presetId: 'coding-guard',
          path: '/tmp/factory/.edictum/workflow-profile.yaml',
          scope: 'project',
          projectId: 'project-1',
          validation: { valid: true },
          source: 'saved',
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    await screen.findByTestId('factory-settings-summary')
    expect(screen.getByTestId('factory-settings-tile-workflows')).toHaveTextContent('1')
    expect(screen.getAllByText('coding-guard')).toHaveLength(1)
    expect(screen.getByText('/tmp/factory/.edictum/workflow-profile.yaml')).toBeInTheDocument()
  })
})

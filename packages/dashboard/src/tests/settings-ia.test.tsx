import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { mockFetch, renderWithProviders } from './test-utils'
import { typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
  localStorage.clear()
})

describe('Settings information architecture', () => {
  it('separates editable config, routing, notifications, catalog, workflow gates, and diagnostics', async () => {
    fetchHelper = mockFetch(typedSettingsMocks())

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory configuration' })).toBeInTheDocument()
    })

    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getByRole('link', { name: 'Runtime config' })).toHaveAttribute('href', '#settings-runtime')
    expect(within(nav).getByRole('link', { name: 'Agents' })).toHaveAttribute('href', '#settings-agents')
    expect(within(nav).getByRole('link', { name: 'Notifications' })).toHaveAttribute('href', '#settings-notifications')
    expect(within(nav).getByRole('link', { name: 'Catalog / gates' })).toHaveAttribute('href', '#settings-catalog')
    expect(within(nav).getByRole('link', { name: 'Diagnostics' })).toHaveAttribute('href', '#settings-diagnostics')

    expect(screen.getByRole('heading', { name: 'Editable runtime config' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Agents and routing' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Secrets' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Catalog and workflow gates' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Diagnostics' })).toBeInTheDocument()

    expect(screen.getAllByTestId('factory-agent-Atlas')).toHaveLength(1)
    expect(screen.getByTestId('agent-settings-Atlas')).toContainElement(screen.getByTestId('factory-agent-Atlas'))
    expect(screen.getByText(/Workflow gate editing is not shipped in browser yet/)).toBeInTheDocument()

    const catalog = screen.getByTestId('factory-models-catalog')
    expect(within(catalog).getByText('read-only')).toBeInTheDocument()
    expect(catalog.querySelectorAll('button, input, select, textarea')).toHaveLength(0)
  })
})

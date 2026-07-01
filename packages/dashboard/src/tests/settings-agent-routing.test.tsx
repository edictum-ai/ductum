import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import { factorySettingsFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Settings agent routing', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('lets agent routing select built-in catalog models and workflows', async () => {
    const fixture = factorySettingsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: fixture.models.map((model) => ({ ...model, source: 'built-in' as const })),
        workflows: fixture.workflows.map((workflow) => ({ ...workflow, source: 'built-in' as const })),
      }),
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const modelRef = await screen.findByRole('combobox', { name: 'Model' })
    expect(modelRef).toHaveTextContent('Model ID: gpt-5.4')
    expect(screen.getByTestId('agent-workflow-ref-Atlas')).toHaveTextContent('WorkflowProfile ID: coding-guard')
    fireEvent.change(modelRef, { target: { value: 'model_gpt' } })
    fireEvent.click(within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' }))

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

  it('saves workflow-only changes from built-in catalog records', async () => {
    const fixture = factorySettingsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: fixture.models.map((model) => ({ ...model, source: 'built-in' as const })),
        workflows: [
          ...fixture.workflows.map((workflow) => ({ ...workflow, source: 'built-in' as const })),
          {
            recordType: 'Workflow',
            id: 'wf_fast_review',
            name: 'fast-review',
            scope: 'factory',
            projectId: null,
            workflowId: 'fast-review',
            path: 'PROCESS.fast-review.md',
            validation: { valid: true },
            source: 'built-in' as const,
          },
        ],
      }),
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const workflowRef = await screen.findByTestId('agent-workflow-ref-Atlas')
    fireEvent.change(workflowRef, { target: { value: 'wf_fast_review' } })
    fireEvent.click(within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' }))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])).toEqual({
      resourceRefs: {
        modelRef: 'model_sonnet',
        harnessRef: 'harness_claude',
        sandboxRef: 'sandbox_builder',
        workflowProfileRef: 'wf_fast_review',
      },
      costTier: 70,
    })
  })
})

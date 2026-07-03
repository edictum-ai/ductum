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

  it('lists built-in workflow profiles in the Agent routing picker', async () => {
    const fixture = factorySettingsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        // Catalog seeded with only built-in workflows; saved-only filtering
        // would render the picker empty and break the assertion below.
        workflows: fixture.workflows.map((workflow) => ({ ...workflow, source: 'built-in' as const })),
      }),
    }))

    renderWithProviders(<Settings />)

    const workflowRef = await screen.findByTestId('agent-workflow-ref-Atlas')
    // coding-guard is the seeded built-in workflow id; if it is missing the
    // picker regressed to saved-only filtering (issue #204).
    expect(workflowRef).toHaveTextContent('WorkflowProfile ID: coding-guard')
  })

  it('saves built-in catalog model selections as direct model IDs', async () => {
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
    // Built-in workflow profile must be selectable so the agent's existing
    // workflowProfileRef survives a model-only edit.
    expect(screen.getByTestId('agent-workflow-ref-Atlas')).toHaveTextContent('WorkflowProfile ID: coding-guard')
    fireEvent.change(modelRef, { target: { value: 'model_gpt' } })
    fireEvent.click(within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' }))

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })
    expect(requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])).toEqual({
      model: 'gpt-5.4',
      resourceRefs: {
        harnessRef: 'harness_claude',
        sandboxRef: 'sandbox_builder',
        workflowProfileRef: 'wf_guard',
      },
      costTier: 70,
    })
  })

  it('saves built-in workflow-only changes and preserves model/harness refs', async () => {
    const fixture = factorySettingsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: fixture.models,
        workflows: [
          // Existing workflow becomes built-in so saved-only filtering would
          // hide it; an additional built-in profile gives the picker a second
          // option to select.
          ...fixture.workflows.map((workflow) => ({ ...workflow, source: 'built-in' as const })),
          {
            recordType: 'Workflow',
            id: 'wf_strict',
            name: 'strict-guard',
            scope: 'factory',
            projectId: null,
            workflowId: 'strict-guard',
            path: 'PROCESS.strict.md',
            validation: { valid: true },
            source: 'built-in' as const,
          },
        ],
      }),
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const workflowRef = await screen.findByTestId('agent-workflow-ref-Atlas')
    // Both built-in profiles must show up; saved-only filtering would drop
    // both options and disable Save on the upcoming change.
    expect(workflowRef).toHaveTextContent('WorkflowProfile ID: coding-guard')
    expect(workflowRef).toHaveTextContent('WorkflowProfile ID: strict-guard')
    fireEvent.change(workflowRef, { target: { value: 'wf_strict' } })
    const saveButton = within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })
    const body = requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])
    // No raw top-level model/harness fields when only workflow changes.
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('harness')
    expect(body).toEqual({
      resourceRefs: {
        modelRef: 'model_sonnet',
        harnessRef: 'harness_claude',
        sandboxRef: 'sandbox_builder',
        workflowProfileRef: 'wf_strict',
      },
      costTier: 70,
    })
  })

  it('saves workflow-only changes to saved workflow records', async () => {
    const fixture = factorySettingsFixture()
    fetchHelper = mockFetch(typedSettingsMocks({
      '/api/factory-settings': factorySettingsFixture({
        models: fixture.models,
        workflows: [
          ...fixture.workflows,
          {
            recordType: 'Workflow',
            id: 'wf_fast_review',
            name: 'fast-review',
            scope: 'factory',
            projectId: null,
            workflowId: 'fast-review',
            path: 'PROCESS.fast-review.md',
            validation: { valid: true },
            source: 'saved' as const,
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

  it('saves sandbox-only changes without raw top-level model or harness fields', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'PUT /api/agents/agent_atlas': { id: 'agent_atlas', name: 'Atlas' },
    }))

    renderWithProviders(<Settings />)

    const sandboxRef = await screen.findByTestId('agent-sandbox-ref-Atlas')
    // Clearing the sandbox is the only change; modelRef, harnessRef, and the
    // saved workflowProfileRef must survive and no raw model/harness may be
    // sent at the top level.
    fireEvent.change(sandboxRef, { target: { value: '' } })
    const saveButton = within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')).toHaveLength(1)
    })
    const body = requestBody(callsOf(fetchHelper, 'PUT', '/api/agents/agent_atlas')[0] as [RequestInfo, RequestInit])
    expect(body).not.toHaveProperty('model')
    expect(body).not.toHaveProperty('harness')
    expect(body).toEqual({
      resourceRefs: {
        modelRef: 'model_sonnet',
        harnessRef: 'harness_claude',
        workflowProfileRef: 'wf_guard',
      },
      costTier: 70,
    })
  })

  it('explains why Save is disabled when the model select is cleared', async () => {
    fetchHelper = mockFetch(typedSettingsMocks())

    renderWithProviders(<Settings />)

    const modelRef = await screen.findByTestId('agent-model-ref-Atlas')
    fireEvent.change(modelRef, { target: { value: '' } })

    // Routing edit appears unsaved, but the Save button stays disabled
    // because no model is selected. The operator must see why — a dead
    // button with no copy violates the #244 settings truthfulness gap.
    const saveButton = within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' })
    expect(saveButton).toBeDisabled()
    expect(screen.getByTestId('agent-save-disabled-reason-Atlas')).toHaveTextContent('Pick a model to save')
  })

  it('explains why Save is disabled when the saved model is missing from the catalog', async () => {
    const fixture = factorySettingsFixture()
    const atlas = fixture.agents[0]!
    fetchHelper = mockFetch(typedSettingsMocks({
      // Empty model catalog, but the agent carries a real model identity
      // (modelId/providerModelId) that can survive without a catalog row.
      // The Save button stays disabled until the operator picks a model
      // that actually exists, and the explainer must say so.
      '/api/factory-settings': factorySettingsFixture({
        models: [],
        agents: [{
          ...atlas,
          modelRef: 'model_missing',
          modelId: 'claude-sonnet-4-6',
          providerModelId: 'claude-sonnet-4-6',
          resourceRefs: { ...atlas.resourceRefs, modelRef: 'model_missing' },
        }],
      }),
    }))

    renderWithProviders(<Settings />)

    const modelRef = await screen.findByTestId('agent-model-ref-Atlas')
    // The agent's saved modelRef has nowhere to land in the picker, and
    // there is no catalog model to switch to — so the operator must first
    // add one out-of-band. Save is gated on that and the explainer says
    // exactly that, rather than leaving a silent disabled button.
    fireEvent.change(modelRef, { target: { value: '' } })
    expect(within(screen.getByTestId('agent-settings-Atlas')).getByRole('button', { name: 'Save Atlas agent routing' })).toBeDisabled()
    expect(screen.getByTestId('agent-save-disabled-reason-Atlas')).toHaveTextContent('Pick a model to save')
  })
})

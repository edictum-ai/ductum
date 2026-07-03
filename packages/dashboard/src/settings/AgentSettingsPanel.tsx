import { useState } from 'react'

import type { AgentUpdateInput } from '@/api/client'
import type {
  FactorySettingsAgent,
  FactorySettingsCatalogs,
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsSandboxProfile,
  FactorySettingsWorkflow,
} from '@/api/factory-settings-types'
import { useUpdateAgent } from '@/api/hooks'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { Field, WriteStatus, fieldStyle } from '@/settings/controls'
import { firstNonEmpty, matchesAnyNonEmpty, sameNonEmpty } from '@/settings/value-utils'

interface DraftRefs {
  modelRef: string
  harnessRef: string
  sandboxRef: string
  workflowProfileRef: string
}

export function AgentSettingsPanel({ data }: { data: FactorySettingsCatalogs }) {
  const update = useUpdateAgent()
  const [drafts, setDrafts] = useState<Record<string, DraftRefs>>({})
  const selectableModels = data.models
  // Both built-in and saved workflow profiles are selectable and saveable as
  // resourceRefs.workflowProfileRef. Filtering to source === 'saved' hid
  // built-in profiles from the picker and orphaned agents whose saved ref
  // points at a built-in workflow (issue #204).
  const selectableWorkflows = data.workflows

  function setDraft(agent: FactorySettingsAgent, patch: Partial<DraftRefs>) {
    setDrafts((current) => ({ ...current, [agent.id]: { ...savedRefs(agent, data), ...current[agent.id], ...patch } }))
  }

  function save(agent: FactorySettingsAgent) {
    const draft = drafts[agent.id] ?? savedRefs(agent, data)
    update.mutate({
      id: agent.id,
      ...agentUpdatePayload(agent, draft, data),
      costTier: agent.settings.costTier,
    }, {
      onSuccess: () => setDrafts(({ [agent.id]: _saved, ...rest }) => rest),
    })
  }

  return (
    <Card>
      <CardHeader
        title="Agent routing"
        meta="Agent refs saved through /api/agents"
        action={<WriteStatus pending={update.isPending} error={update.error} result={null} data-testid="agent-settings-status" />}
      />
      {data.agents.length === 0 ? (
        <Mono color={tokens.faint}>No agents registered</Mono>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {data.agents.map((agent) => {
            const saved = savedRefs(agent, data)
            const draft = drafts[agent.id] ?? saved
            const dirty = !sameRefs(saved, draft)
            const hasModelIdentity = firstNonEmpty([agent.modelRef, agent.modelId, agent.providerModelId], 'unknown') !== 'unknown'
            const hasHarnessIdentity = firstNonEmpty([agent.harnessRef, agent.harnessId, agent.harnessType], 'unknown') !== 'unknown'
            const hasModelOption = draft.modelRef === '' || selectableModels.some((model) => model.id === draft.modelRef)
            const hasHarnessOption = draft.harnessRef === '' || data.harnesses.some((harness) => harness.id === draft.harnessRef)
            const hasWorkflowOption = draft.workflowProfileRef === '' || selectableWorkflows.some((workflow) => workflow.id === draft.workflowProfileRef)
            const saveDisabled = !dirty || update.isPending || !hasModelOption || !hasHarnessOption || !hasWorkflowOption || draft.modelRef === '' || draft.harnessRef === ''
            const disabledReason = dirty && !update.isPending ? agentSaveDisabledReason({
              modelRef: draft.modelRef,
              harnessRef: draft.harnessRef,
              hasModelOption,
              hasHarnessOption,
              hasWorkflowOption,
            }) : null
            return (
              <section key={agent.id} data-testid={`agent-settings-${agent.name}`} style={{ display: 'grid', gap: 12, borderTop: `1px solid ${tokens.hair}`, paddingTop: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontFamily: tokens.sans, fontSize: 16, color: tokens.strong }}>{agent.name}</span>
                    <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 3 }}>
                      {agent.role} · {agent.settings.effort ?? 'default'} · {agent.enabled ? 'enabled' : 'disabled'} · cost tier {agent.settings.costTier}
                    </Mono>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {disabledReason != null && (
                      <span data-testid={`agent-save-disabled-reason-${agent.name}`}>
                        <Mono size={11} color={tokens.warn}>
                          {disabledReason}
                        </Mono>
                      </span>
                    )}
                    <Btn small primary disabled={saveDisabled} onClick={() => save(agent)} aria-label={`Save ${agent.name} agent routing`}>
                      Save
                    </Btn>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
                  <Field label="Model">
                    <select data-testid={`agent-model-ref-${agent.name}`} value={draft.modelRef} onChange={(e) => setDraft(agent, { modelRef: e.target.value })} style={fieldStyle}>
                      <option value="">Select model</option>
                      {!hasModelOption && hasModelIdentity && <option value={draft.modelRef}>{currentModelLabel(agent)}</option>}
                      {selectableModels.map((model) => (
                        <option key={model.id} value={model.id}>{modelLabel(model)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Harness">
                    <select data-testid={`agent-harness-ref-${agent.name}`} value={draft.harnessRef} onChange={(e) => setDraft(agent, { harnessRef: e.target.value })} style={fieldStyle}>
                      <option value="">Select harness</option>
                      {!hasHarnessOption && hasHarnessIdentity && <option value={draft.harnessRef}>{currentHarnessLabel(agent)}</option>}
                      {data.harnesses.map((harness) => (
                        <option key={harness.id} value={harness.id}>{harnessLabel(harness)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sandbox">
                    <select data-testid={`agent-sandbox-ref-${agent.name}`} value={draft.sandboxRef} onChange={(e) => setDraft(agent, { sandboxRef: e.target.value })} style={fieldStyle}>
                      <option value="">none</option>
                      {data.sandboxProfiles.map((sandbox) => (
                        <option key={sandbox.id} value={sandbox.id}>{sandboxLabel(sandbox)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Workflow profile">
                    <select data-testid={`agent-workflow-ref-${agent.name}`} value={draft.workflowProfileRef} onChange={(e) => setDraft(agent, { workflowProfileRef: e.target.value })} style={fieldStyle}>
                      <option value="">none</option>
                      {selectableWorkflows.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>{workflowLabel(workflow)}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Mono size={11} color={tokens.dim}>
                  capabilities: {agent.settings.capabilities.join(', ') || 'none'} · effort: {agent.settings.effort ?? 'default'} · pricing: {agentPricing(agent)} · secret access refs: {agent.secretAccessRefs.join(', ') || 'none'}
                </Mono>
                <span data-testid={`factory-agent-${agent.name}`}>
                  <Mono size={11} color={tokens.mid}>
                    Model: {agentModelLabel(agent, data.models)} · Harness: {agentHarnessLabel(agent, data.harnesses)}
                  </Mono>
                </span>
              </section>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function savedRefs(agent: FactorySettingsAgent, data: FactorySettingsCatalogs): DraftRefs {
  return {
    modelRef: firstNonEmpty([matchModel(data.models, agent.modelRef, agent.modelId, agent.providerModelId)?.id, agent.modelRef, agent.modelId, agent.providerModelId], ''),
    harnessRef: firstNonEmpty([matchHarness(data.harnesses, agent.harnessRef, agent.harnessId, agent.harnessType)?.id, agent.harnessRef, agent.harnessId, agent.harnessType], ''),
    sandboxRef: firstNonEmpty([matchSandbox(data.sandboxProfiles, agent.sandboxRef)?.id, agent.sandboxRef], ''),
    workflowProfileRef: matchWorkflow(data.workflows, agent.workflowProfileRef)?.id ?? '',
  }
}

function agentUpdatePayload(
  agent: FactorySettingsAgent,
  draft: DraftRefs,
  data: FactorySettingsCatalogs,
): Pick<AgentUpdateInput, 'model' | 'resourceRefs'> {
  const refs = cleanRefs({ ...agent.resourceRefs, ...draft })
  const model = data.models.find((item) => item.id === draft.modelRef)
  if (model != null && model.source !== 'saved') {
    delete refs.modelRef
    return { model: model.modelId, resourceRefs: refs }
  }
  return { resourceRefs: refs }
}

function cleanRefs(refs: FactorySettingsAgent['resourceRefs']): FactorySettingsAgent['resourceRefs'] {
  return Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== '')) as FactorySettingsAgent['resourceRefs']
}

function sameRefs(a: DraftRefs, b: DraftRefs): boolean {
  return a.modelRef === b.modelRef && a.harnessRef === b.harnessRef
    && a.sandboxRef === b.sandboxRef && a.workflowProfileRef === b.workflowProfileRef
}

/**
 * Visible reason the per-agent Save button is disabled despite a pending
 * edit. Returning null here is fine only when the disabled state is
 * self-evident (no edit yet, or a save in flight); a routing edit that
 * cannot be saved must explain itself so the operator is never left
 * looking at a dead button.
 */
function agentSaveDisabledReason(refs: {
  modelRef: string
  harnessRef: string
  hasModelOption: boolean
  hasHarnessOption: boolean
  hasWorkflowOption: boolean
}): string | null {
  if (refs.modelRef === '') return 'Pick a model to save'
  if (refs.harnessRef === '') return 'Pick a harness to save'
  if (!refs.hasModelOption) return 'Current model is not in the catalog; choose a catalog model to save'
  if (!refs.hasHarnessOption) return 'Current harness is not in the catalog; choose a catalog harness to save'
  if (!refs.hasWorkflowOption) return 'Current workflow profile is not in the catalog; choose a catalog workflow to save'
  return null
}

function matchModel(models: FactorySettingsModel[], ref: string | undefined, modelId: string, providerModelId: string) {
  return models.find((model) => matchesAnyNonEmpty(ref, [model.id, model.name, model.modelId, model.providerModelId])
    || sameNonEmpty(model.modelId, modelId) || sameNonEmpty(model.providerModelId, providerModelId))
}

function matchHarness(harnesses: FactorySettingsHarness[], ref: string | undefined, harnessId: string, adapterType: string) {
  return harnesses.find((harness) => matchesAnyNonEmpty(ref, [harness.id, harness.name, harness.harnessId, harness.adapterType])
    || sameNonEmpty(harness.harnessId, harnessId) || sameNonEmpty(harness.adapterType, adapterType))
}

function matchSandbox(sandboxes: FactorySettingsSandboxProfile[], ref: string | undefined) {
  return sandboxes.find((sandbox) => matchesAnyNonEmpty(ref, [sandbox.id, sandbox.name, sandbox.sandboxProfileId]))
}

function matchWorkflow(workflows: FactorySettingsWorkflow[], ref: string | undefined) {
  return workflows.find((workflow) => matchesAnyNonEmpty(ref, [workflow.id, workflow.name, workflow.workflowId]))
}

function modelLabel(model: FactorySettingsModel): string {
  return [
    `Model ID: ${model.modelId}`,
    `provider model ID: ${model.providerModelId}`,
    `provider ID: ${model.providerId}`,
    `catalog metadata: ${model.catalogSource ?? 'unknown'}`,
    `saved config: ${model.savedConfigState ?? 'unknown'}`,
    `availability: ${model.availability ?? 'unknown'}`,
    `harnesses: ${list(model.supportedHarnesses)}`,
    `efforts: ${list(model.supportedEfforts)}`,
    `options: ${list(model.supportedOptions)}`,
    modelPricing(model),
    `verified: ${model.lastVerifiedAt ?? 'unknown'}`,
    `source: ${model.sourceUrl ?? 'unrecorded'}`,
  ].join(' | ')
}

function harnessLabel(harness: FactorySettingsHarness): string {
  return `Harness ID: ${harness.harnessId} | adapter type: ${harness.adapterType}`
}

function sandboxLabel(sandbox: FactorySettingsSandboxProfile): string {
  return `Sandbox ID: ${sandbox.sandboxProfileId} | ${sandbox.provider}/${sandbox.mode}`
}

function workflowLabel(workflow: FactorySettingsWorkflow): string {
  return `WorkflowProfile ID: ${workflow.workflowId} | ${workflow.path}`
}

function currentModelLabel(agent: FactorySettingsAgent): string {
  const identity = firstNonEmpty([agent.modelId, agent.providerModelId], '')
  if (identity !== '') return `${identity} (current, not in catalog)`
  return firstNonEmpty([agent.modelRef], '') === '' ? 'Current model unavailable' : 'Current model not in catalog'
}

function currentHarnessLabel(agent: FactorySettingsAgent): string {
  const identity = firstNonEmpty([agent.harnessId, agent.harnessType], '')
  if (identity !== '') return `${identity} (current, not in catalog)`
  return firstNonEmpty([agent.harnessRef], '') === '' ? 'Current harness unavailable' : 'Current harness not in catalog'
}

function modelPricing(model: FactorySettingsModel): string {
  if (model.pricingState === 'unmeasured' || model.pricing == null) {
    return `pricing: missing${model.pricingNote ? ` (${model.pricingNote})` : ''}`
  }
  return `pricing: $${money(model.pricing.inputUsdPer1M)}/M in, $${money(model.pricing.outputUsdPer1M)}/M out${model.pricingSource ? `, source: ${model.pricingSource}` : ''}`
}

function agentPricing(agent: FactorySettingsAgent): string {
  if (agent.settings.pricing == null) return 'catalog/default'
  return `override $${money(agent.settings.pricing.inputUsdPer1M)}/M in, $${money(agent.settings.pricing.outputUsdPer1M)}/M out`
}

function agentModelLabel(agent: FactorySettingsAgent, models: FactorySettingsModel[]): string {
  const match = matchModel(models, agent.modelRef, agent.modelId, agent.providerModelId)
  if (match != null) return firstNonEmpty([match.modelId, match.providerModelId, match.name], 'unavailable')
  const identity = firstNonEmpty([agent.modelId, agent.providerModelId], '')
  if (identity !== '') return identity
  return firstNonEmpty([agent.modelRef], '') === '' ? 'unavailable' : 'not in catalog'
}

function agentHarnessLabel(agent: FactorySettingsAgent, harnesses: FactorySettingsHarness[]): string {
  const match = matchHarness(harnesses, agent.harnessRef, agent.harnessId, agent.harnessType)
  if (match != null) return firstNonEmpty([match.harnessId, match.adapterType, match.name], 'unavailable')
  const identity = firstNonEmpty([agent.harnessId, agent.harnessType], '')
  if (identity !== '') return identity
  return firstNonEmpty([agent.harnessRef], '') === '' ? 'unavailable' : 'not in catalog'
}

function list(values: readonly string[] | undefined): string {
  return values == null || values.length === 0 ? 'none' : values.join('/')
}

function money(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

import { useState } from 'react'

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

  function setDraft(agent: FactorySettingsAgent, patch: Partial<DraftRefs>) {
    setDrafts((current) => ({ ...current, [agent.id]: { ...savedRefs(agent, data), ...current[agent.id], ...patch } }))
  }

  function save(agent: FactorySettingsAgent) {
    const draft = drafts[agent.id] ?? savedRefs(agent, data)
    update.mutate({
      id: agent.id,
      resourceRefs: cleanRefs({ ...agent.resourceRefs, ...draft }),
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
            return (
              <section key={agent.id} data-testid={`agent-settings-${agent.name}`} style={{ display: 'grid', gap: 12, borderTop: `1px solid ${tokens.hair}`, paddingTop: 14 }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontFamily: tokens.sans, fontSize: 16, color: tokens.strong }}>{agent.name}</span>
                    <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 3 }}>
                      {agent.role} · {agent.settings.effort ?? 'default'} · {agent.enabled ? 'enabled' : 'disabled'} · cost tier {agent.settings.costTier}
                    </Mono>
                  </div>
                  <Btn small primary disabled={!dirty || update.isPending || !hasModelOption || !hasHarnessOption || draft.modelRef === '' || draft.harnessRef === ''} onClick={() => save(agent)} aria-label={`Save ${agent.name} agent routing`}>
                    Save
                  </Btn>
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
                      {data.workflows.map((workflow) => (
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
    workflowProfileRef: firstNonEmpty([matchWorkflow(data.workflows, agent.workflowProfileRef)?.id, agent.workflowProfileRef], ''),
  }
}

function cleanRefs(refs: FactorySettingsAgent['resourceRefs']): FactorySettingsAgent['resourceRefs'] {
  return Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== '')) as FactorySettingsAgent['resourceRefs']
}

function sameRefs(a: DraftRefs, b: DraftRefs): boolean {
  return a.modelRef === b.modelRef && a.harnessRef === b.harnessRef
    && a.sandboxRef === b.sandboxRef && a.workflowProfileRef === b.workflowProfileRef
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

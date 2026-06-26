import type { ReactNode } from 'react'

import type { FactorySettingsCatalogs } from '@/api/factory-settings-types'
import { Card, CardHeader, Mono, Num, tokens } from '@/components/signal'
import { NotificationChannelsPanel } from '@/settings/NotificationChannelsPanel'
import { firstNonEmpty, matchesAnyNonEmpty, sameNonEmpty } from '@/settings/value-utils'

/**
 * Typed catalog view of GET /api/factory-settings: live DB-backed records,
 * not parsed config text. Catalog editors are not shipped yet, so these
 * panels stay honest about the supported CLI/env/factory-file setup path.
 */
export function FactorySettingsView({ data }: { data: FactorySettingsCatalogs }) {
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
        }}
        data-testid="factory-settings-summary"
      >
        <Tile label="Agents" value={data.agents.length} meta="registered" testId="factory-settings-tile-agents" warnWhenZero />
        <Tile label="Providers" value={data.providers.length} meta="model sources" testId="factory-settings-tile-providers" warnWhenZero />
        <Tile label="Models" value={data.models.length} meta="in catalog" testId="factory-settings-tile-models" warnWhenZero />
        <Tile label="Harnesses" value={data.harnesses.length} meta="adapters" testId="factory-settings-tile-harnesses" warnWhenZero />
        <Tile label="Workflows" value={data.workflows.length} meta="profiles" testId="factory-settings-tile-workflows" warnWhenZero />
        <Tile label="Sandboxes" value={data.sandboxProfiles.length} meta="profiles" testId="factory-settings-tile-sandboxes" warnWhenZero />
        <Tile label="Channels" value={data.notificationChannels.length} meta="notification" testId="factory-settings-tile-channels" warnWhenZero />
      </div>

      <Card>
        <CardHeader title="Agents" meta="who can run Attempts" action={<ReadOnly />} />
        {data.agents.length === 0 ? (
          <Mono color={tokens.faint}>No agents registered</Mono>
        ) : (
          data.agents.map((agent, i) => (
            <Line key={agent.id} first={i === 0} data-testid={`factory-agent-${agent.name}`}>
              <NameCell name={agent.name} sub={`Model: ${agentModelLabel(agent, data.models)} · Harness: ${agentHarnessLabel(agent, data.harnesses)}`} />
              <Mono size={11.5} color={tokens.mid}>
                {agent.role}{agent.settings.effort ? ` · ${agent.settings.effort}` : ''}
              </Mono>
              <Mono size={11.5} color={tokens.dim}>
                {agent.settings.capabilities.join(', ') || 'no capabilities'}
              </Mono>
              <Mono size={11} color={agent.enabled ? tokens.ok : tokens.faint}>
                {agent.enabled ? 'enabled' : 'disabled'}
              </Mono>
            </Line>
          ))
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
        <CatalogCard title="Providers" meta="model sources" empty="No providers" note={SETUP_NOTE}>
          {data.providers.map((provider, i) => (
            <Line key={provider.id} first={i === 0}>
              <NameCell name={provider.label} sub={provider.providerId} />
              <Mono size={11.5} color={tokens.dim}>{provider.modelCount} model{provider.modelCount === 1 ? '' : 's'}</Mono>
            </Line>
          ))}
        </CatalogCard>

        <CatalogCard title="Models" meta="model identity · availability · source" empty="No models" note={SETUP_NOTE} testId="factory-models-catalog">
          {data.models.map((model, i) => (
            <Line key={model.id} first={i === 0} data-testid={`factory-model-${model.name}`}>
              <NameCell
                name={model.name}
                sub={modelDetails(model)}
              />
              <Mono size={11.5} color={model.pricingState === 'unmeasured' ? tokens.warn : tokens.dim}>
                {modelPricing(model)}
              </Mono>
            </Line>
          ))}
        </CatalogCard>

        <CatalogCard title="Harnesses" meta="Harness ID · adapter type" empty="No harnesses" note={SETUP_NOTE}>
          {data.harnesses.map((harness, i) => (
            <Line key={harness.id} first={i === 0}>
              <NameCell name={harness.name} sub={`Harness ID: ${harness.harnessId}${harness.controlMode ? ` · control: ${harness.controlMode}` : ''}`} />
              <Mono size={11.5} color={tokens.dim}>adapter type: {harness.adapterType}</Mono>
            </Line>
          ))}
        </CatalogCard>

        <CatalogCard title="Workflows" meta="process profiles" empty="No workflows">
          {data.workflows.map((workflow, i) => (
            <Line key={workflow.id} first={i === 0}>
              <NameCell name={workflow.name} sub={workflow.path} />
              <Mono size={11.5} color={workflow.validation?.valid === false ? tokens.err : tokens.ok}>
                {workflow.validation?.valid === false ? 'invalid' : 'valid'}
              </Mono>
            </Line>
          ))}
        </CatalogCard>

        <CatalogCard title="Sandboxes" meta="provider · mode" empty="No sandboxes" note={SETUP_NOTE}>
          {data.sandboxProfiles.map((sandbox, i) => (
            <Line key={sandbox.id} first={i === 0}>
              <NameCell name={sandbox.name} sub={sandbox.mode} />
              <Mono size={11.5} color={tokens.dim}>{sandbox.provider}</Mono>
            </Line>
          ))}
        </CatalogCard>

        <NotificationChannelsPanel catalogChannels={data.notificationChannels} />
      </div>
    </div>
  )
}

const SETUP_NOTE = 'Read-only in browser. Create or change these records with the Ductum CLI, environment variables, or factory files; Settings only shows what the factory has loaded.'

function ReadOnly() {
  return <Mono size={10.5} color={tokens.faint}>read-only</Mono>
}

function CatalogCard({
  title,
  meta,
  empty,
  note,
  children,
  testId,
}: {
  title: string
  meta: string
  empty: string
  note?: string
  children: ReactNode[]
  testId?: string
}) {
  return (
    <Card style={{ minWidth: 0 }}>
      <div data-testid={testId}>
        <CardHeader title={title} meta={meta} action={<ReadOnly />} />
        {note != null && (
          <Mono size={11} color={tokens.mid} style={{ display: 'block', marginBottom: 8 }}>
            {note}
          </Mono>
        )}
        {children.length === 0 ? <Mono color={tokens.faint}>{empty}</Mono> : children}
      </div>
    </Card>
  )
}

function Line({
  children,
  first,
  'data-testid': testId,
}: {
  children: ReactNode
  first: boolean
  'data-testid'?: string
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '11px 0',
        borderTop: first ? 'none' : `1px solid ${tokens.hair}`,
      }}
    >
      {children}
    </div>
  )
}

function NameCell({ name, sub }: { name: string; sub: string }) {
  return (
    <div style={{ minWidth: 0, flex: 1 }}>
      <span style={{ fontFamily: tokens.sans, fontSize: 14, color: tokens.strong }}>{name}</span>
      {sub !== '' && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 2, overflowWrap: 'anywhere' }}>
          {sub}
        </Mono>
      )}
    </div>
  )
}

function modelDetails(model: FactorySettingsCatalogs['models'][number]): string {
  return [
    `Ductum model ID: ${model.modelId}`,
    `provider ID: ${model.providerId}`,
    `provider model ID: ${model.providerModelId}`,
    `catalog metadata: ${model.catalogSource ?? 'unknown'}`,
    `saved config: ${model.savedConfigState ?? 'unknown'}`,
    `availability: ${model.availability ?? 'unknown'}`,
    `harnesses: ${list(model.supportedHarnesses)}`,
    `efforts: ${list(model.supportedEfforts)}`,
    `options: ${list(model.supportedOptions)}`,
    `verified: ${model.lastVerifiedAt ?? 'unknown'}`,
    `source: ${model.sourceUrl ?? 'unrecorded'}`,
  ].join(' · ')
}

function agentModelLabel(
  agent: FactorySettingsCatalogs['agents'][number],
  models: FactorySettingsCatalogs['models'],
): string {
  const match = models.find((model) => matchesAnyNonEmpty(agent.modelRef, [model.id, model.name, model.modelId, model.providerModelId])
    || sameNonEmpty(model.modelId, agent.modelId) || sameNonEmpty(model.providerModelId, agent.providerModelId))
  if (match != null) {
    return firstNonEmpty([match.modelId, match.providerModelId, match.name], 'unavailable')
  }
  const identity = firstNonEmpty([agent.modelId, agent.providerModelId], '')
  if (identity !== '') return identity
  return firstNonEmpty([agent.modelRef], '') === '' ? 'unavailable' : 'not in catalog'
}

function agentHarnessLabel(
  agent: FactorySettingsCatalogs['agents'][number],
  harnesses: FactorySettingsCatalogs['harnesses'],
): string {
  const match = harnesses.find((harness) => matchesAnyNonEmpty(agent.harnessRef, [harness.id, harness.name, harness.harnessId, harness.adapterType])
    || sameNonEmpty(harness.harnessId, agent.harnessId) || sameNonEmpty(harness.adapterType, agent.harnessType))
  if (match != null) {
    return firstNonEmpty([match.harnessId, match.adapterType, match.name], 'unavailable')
  }
  const identity = firstNonEmpty([agent.harnessId, agent.harnessType], '')
  if (identity !== '') return identity
  return firstNonEmpty([agent.harnessRef], '') === '' ? 'unavailable' : 'not in catalog'
}

function modelPricing(model: FactorySettingsCatalogs['models'][number]): string {
  if (model.pricingState === 'unmeasured' || model.pricing == null) {
    return `pricing: unmeasured${model.pricingNote ? ` (${model.pricingNote})` : ''}`
  }
  return `pricing: $${money(model.pricing.inputUsdPer1M)}/M in · $${money(model.pricing.outputUsdPer1M)}/M out${model.pricingSource ? ` · source: ${model.pricingSource}` : ''}`
}

function list(values: readonly string[] | undefined): string {
  return values == null || values.length === 0 ? 'none' : values.join('/')
}

function money(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function Tile({
  label,
  value,
  meta,
  testId,
  warnWhenZero,
}: {
  label: string
  value: number
  meta: string
  testId: string
  warnWhenZero?: boolean
}) {
  const valueTone = warnWhenZero === true && value === 0 ? tokens.warn : tokens.strong
  return (
    <div data-testid={testId}>
      <Card pad={14}>
        <Mono size={11} color={tokens.dim}>{label}</Mono>
        <div style={{ marginTop: 8 }}>
          <Num size={30} color={valueTone}>{value}</Num>
        </div>
        <Mono size={11} color={tokens.faint}>{meta}</Mono>
      </Card>
    </div>
  )
}

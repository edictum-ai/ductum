import type { FactorySettingsCatalogs, FactorySettingsSummary } from './factory-settings-types.js'

export function buildFactorySettingsSummary(
  input: Pick<FactorySettingsCatalogs, 'providers' | 'models' | 'harnesses' | 'workflows' | 'agents' | 'sandboxProfiles' | 'notificationChannels'>,
): FactorySettingsSummary {
  return {
    providerCount: input.providers.length,
    modelCount: input.models.length,
    harnessCount: input.harnesses.length,
    workflowCount: input.workflows.length,
    agentCount: input.agents.length,
    sandboxProfileCount: input.sandboxProfiles.length,
    notificationChannelCount: input.notificationChannels.length,
  }
}

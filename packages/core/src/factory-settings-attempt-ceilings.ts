import { describeAttemptResourceCeilings } from './attempt-resource-ceilings.js'
import type { FactorySettingsAttemptCeilings } from './factory-settings-types.js'
import type { Factory } from './types.js'

export function attemptCeilingPreferences(input: Factory['config']['attemptCeilings'] | null | undefined): FactorySettingsAttemptCeilings {
  const summary = describeAttemptResourceCeilings(input)
  return {
    recordType: 'AttemptCeilings',
    id: 'factory-attempt-ceilings',
    name: 'Attempt ceilings',
    enabled: summary.enabled,
    maxInputTokensPerTurn: summary.maxInputTokensPerTurn,
    maxCumulativeCostUsd: summary.maxCumulativeCostUsd,
    maxTurns: summary.maxTurns,
    configSource: summary.source,
    scope: 'factory',
    projectId: null,
    source: summary.source === 'default' ? 'built-in' : 'saved',
  }
}

import type { FactorySettingsRecordBase } from './factory-settings-types.js'

export interface FactorySettingsBudgetPreferences extends FactorySettingsRecordBase<'BudgetPreferences'> {
  perRunWarnUsd: number | null
  perRunHardUsd: number | null
  perSpecHardUsd: number | null
}

export interface FactorySettingsAttemptCeilings extends FactorySettingsRecordBase<'AttemptCeilings'> {
  enabled: boolean
  maxInputTokensPerTurn: number | null
  maxCumulativeCostUsd: number | null
  maxTurns: number | null
  configSource: 'default' | 'configured' | 'disabled'
}

export interface FactorySettingsCostBudgetInput {
  perRunWarnUsd?: number | null
  perRunHardUsd?: number | null
  perSpecHardUsd?: number | null
}

export interface FactorySettingsAttemptCeilingsInput {
  enabled?: boolean | null
  maxInputTokensPerTurn?: number | null
  maxCumulativeCostUsd?: number | null
  maxTurns?: number | null
}

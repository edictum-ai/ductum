// Typed view/write types for the Factory Settings APIs:
//   GET  /api/factory-settings           (aggregate catalogs)
//   GET/PATCH /api/factory/settings      (factory details)
//   GET/PATCH /api/factory/runtime       (current vs desired runtime)
//   /api/factory/secrets*                (write-only secret metadata)
//
// These are the canonical public operator contract DTOs, re-exported from
// @ductum/operator-contract so the dashboard never redeclares them.

export type {
  FactoryRuntimeCurrentSettings,
  FactoryRuntimeDesiredSettings,
  FactoryRuntimeMergeConfig,
  FactoryRuntimePatch,
  FactoryRuntimePersistedSettings,
  FactoryRuntimeSettings,
  FactoryRuntimeWorkflowProfileConfig,
  FactoryRuntimeWorkflowProfileEntry,
  FactorySecretMetadata,
  FactorySecretScope,
  FactorySecretStatus,
  FactorySettingsAffectedRuntime,
  FactorySettingsAgent,
  FactorySettingsAttemptCeilings,
  FactorySettingsAttemptCeilingsInput,
  FactorySettingsBudgetPreferences,
  FactorySettingsCatalogs,
  FactorySettingsCostBudgetInput,
  FactorySettingsDetails,
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsNotificationChannel,
  FactorySettingsPatch,
  FactorySettingsProvider,
  FactorySettingsRuntimePreferences,
  FactorySettingsSandboxProfile,
  FactorySettingsSource,
  FactorySettingsWorkflow,
  FactorySettingsWorkflowValidation,
  FactorySettingsWriteResult,
} from '@ductum/operator-contract'

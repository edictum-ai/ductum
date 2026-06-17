import type { FactoryId, ProjectId } from '../types.js'
import type {
  FactoryRuntimePatch,
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsNotificationChannel,
  FactorySettingsProvider,
  FactorySettingsSandboxProfile,
  FactorySettingsWorkflow,
  FactorySecretMetadata,
} from '../factory-settings-types.js'
import type {
  FactoryRuntimeSettingsRecord,
  FactorySecretCreateInput,
  FactorySecretEncryptedPayload,
  FactorySecretKeySource,
  FactorySecretStoredRecord,
} from '../factory-settings-store-types.js'

export interface FactoryRuntimeSettingsRepo {
  get(factoryId: FactoryId): FactoryRuntimeSettingsRecord | null
  upsert(factoryId: FactoryId, patch: FactoryRuntimePatch): FactoryRuntimeSettingsRecord
}

export interface FactoryCatalogRepo {
  listProviders(): FactorySettingsProvider[]
  listModels(): FactorySettingsModel[]
  listHarnesses(): FactorySettingsHarness[]
  listWorkflows(): FactorySettingsWorkflow[]
  listSandboxProfiles(): FactorySettingsSandboxProfile[]
  listNotificationChannels(): FactorySettingsNotificationChannel[]
}

export interface FactorySecretRepo {
  list(filters?: { projectId?: ProjectId | null }): FactorySecretMetadata[]
  getMetadata(id: string): FactorySecretMetadata | null
  get(id: string): FactorySecretStoredRecord | null
  create(input: FactorySecretCreateInput): FactorySecretStoredRecord
  updateMetadata(
    id: string,
    fields: Partial<Pick<FactorySecretStoredRecord, 'name' | 'description' | 'status' | 'lastRotatedAt' | 'lastTestedAt'>>,
  ): FactorySecretStoredRecord
  update(
    id: string,
    fields: Partial<Pick<FactorySecretStoredRecord, 'name' | 'description' | 'status' | 'lastRotatedAt' | 'lastTestedAt'>>
      & { keySource?: FactorySecretKeySource; payload?: FactorySecretEncryptedPayload },
  ): FactorySecretStoredRecord
  delete(id: string): void
}

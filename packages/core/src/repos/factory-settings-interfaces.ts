import type { FactoryId, ProjectId, RunId } from '../types.js'
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
  FactorySecretAccessEvent,
  FactorySecretAccessEventInput,
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

/**
 * P1 Secret Access Log (issue #210): append-only ledger of every secret
 * resolution attempt. Read paths are scoped by secret and by run for the
 * dashboard. None of the returned events ever carry plaintext or encrypted
 * secret material — only ids, outcome, and a sanitized error message.
 */
export interface FactorySecretAccessLogRepo {
  /** Append a new access event. Returns the persisted event. */
  record(input: FactorySecretAccessEventInput): FactorySecretAccessEvent
  /** Access history for a single secret, newest first. */
  listBySecret(secretId: string, limit?: number): FactorySecretAccessEvent[]
  /** Access history for a single run, newest first. */
  listByRun(runId: RunId, limit?: number): FactorySecretAccessEvent[]
}

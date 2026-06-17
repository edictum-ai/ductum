import type { FactoryId, ProjectId } from './types.js'
import type {
  FactoryRuntimePersistedSettings,
  FactorySecretMetadata,
  FactorySecretScope,
  FactorySecretStatus,
} from './factory-settings-types.js'

export interface FactoryRuntimeSettingsRecord extends FactoryRuntimePersistedSettings {
  factoryId: FactoryId
  createdAt: string
  updatedAt: string
}

export interface FactorySecretEncryptedPayload {
  algorithm: string
  ciphertext: string
  nonce: string
  authTag: string | null
}

export interface FactorySecretKeySource {
  type: 'local-file'
  keyId: string
}

export interface FactorySecretStoredRecord extends FactorySecretMetadata {
  projectId: ProjectId | null
  description: string | null
  keySource: FactorySecretKeySource
  payload: FactorySecretEncryptedPayload
}

export interface FactorySecretCreateInput {
  id: string
  name: string
  scope: FactorySecretScope
  projectId: ProjectId | null
  description: string | null
  status: FactorySecretStatus
  keySource: FactorySecretKeySource
  payload: FactorySecretEncryptedPayload
  lastRotatedAt: string | null
  lastTestedAt: string | null
}

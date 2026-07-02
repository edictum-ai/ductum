import type { AgentId, FactoryId, ProjectId, RunId } from './types.js'
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

/**
 * Issue #210 / P1: durable record of a single `secret:<id>` resolution attempt.
 * Stored append-only; never carries plaintext or encrypted secret material —
 * only identifiers, an outcome, and (on failure) a sanitized error message.
 *
 * `runId` / `agentId` are nullable because the operator-driven `/test` path
 * resolves secrets outside any run. The dispatcher path always has both.
 */
export type FactorySecretAccessOutcome = 'success' | 'failure'

export interface FactorySecretAccessEvent {
  id: string
  secretId: string | null
  runId: RunId | null
  agentId: AgentId | null
  outcome: FactorySecretAccessOutcome
  /** Sanitized failure reason; null on success. Must never include secret values. */
  errorMessage: string | null
  attemptedAt: string
}

/**
 * Context threaded from the dispatcher through the broker to the resolver so
 * each access event can be attributed to a real run/agent. Both fields are
 * optional because some resolution paths (operator `/test` route) have neither.
 */
export interface FactorySecretAccessContext {
  runId?: RunId | null
  agentId?: AgentId | null
}

export interface FactorySecretAccessEventInput {
  id: string
  /** Nullable to log malformed refs (parser returned no target id). */
  secretId: string | null
  runId: RunId | null
  agentId: AgentId | null
  outcome: FactorySecretAccessOutcome
  errorMessage: string | null
  attemptedAt: string
}

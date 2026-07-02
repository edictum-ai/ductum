import { createId } from './types.js'
import type {
  FactorySecretRepo,
  FactorySecretAccessLogRepo,
} from './repos/factory-settings-interfaces.js'
import { decryptFactorySecret, loadFactorySecretKey } from './factory-secret-crypto.js'
import { parseFactorySecretRef } from './factory-secret-refs.js'
import { redactPublicText } from './public-redaction.js'
import type { FactorySecretAccessContext } from './factory-settings-store-types.js'

export interface FactorySecretResolverDeps {
  factoryDir: string
  secrets: Pick<FactorySecretRepo, 'get'>
  /**
   * Optional access log (P1 / issue #210). When present, every `resolve` call
   * appends a success or failure event with the threaded run/agent context.
   * Some callers, such as operator test routes, have no run/agent context; in
   * those cases the event is still recorded with null context fields.
   */
  accessLog?: Pick<FactorySecretAccessLogRepo, 'record'>
  /** Injectable for tests; defaults to the wall clock. */
  now?: () => Date
}

/**
 * Resolves `secret:<id>` references to plaintext and (when an accessLog is
 * configured) records each attempt. Failures are recorded with a sanitized
 * error message before the original error is re-thrown, so callers still see
 * the real failure but the log never carries secret material — the error
 * message is redacted and only the secret *id* (not its value) is stored.
 */
export class FactorySecretResolver {
  private readonly accessLog: Pick<FactorySecretAccessLogRepo, 'record'> | undefined
  private readonly now: () => Date

  constructor(private readonly deps: FactorySecretResolverDeps) {
    this.accessLog = deps.accessLog
    this.now = deps.now ?? (() => new Date())
  }

  resolve(ref: string, context?: FactorySecretAccessContext): string {
    const secretId = parseFactorySecretRef(ref)
    if (secretId == null) {
      this.recordOutcome(secretId, 'failure', 'Secret resolution requires a secret:<id> reference', context)
      throw new Error('Secret resolution requires a secret:<id> reference')
    }
    const stored = this.deps.secrets.get(secretId)
    if (stored == null) {
      this.recordOutcome(secretId, 'failure', `Secret not found for reference: ${ref}`, context)
      throw new Error(`Secret not found for reference: ${ref}`)
    }
    let value: string
    try {
      const key = loadFactorySecretKey(this.deps.factoryDir)
      value = decryptFactorySecret(stored.payload, stored.keySource, key)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordOutcome(secretId, 'failure', message, context)
      throw error
    }
    this.recordOutcome(secretId, 'success', null, context)
    return value
  }

  private recordOutcome(
    secretId: string | null,
    outcome: 'success' | 'failure',
    message: string | null,
    context: FactorySecretAccessContext | undefined,
  ): void {
    if (this.accessLog == null) return
    // Fail closed: resolving a configured factory secret without an audit row
    // would violate the access-log contract for protected agent runs.
    this.accessLog.record({
      id: createId<'FactorySecretAccessEventId'>(),
      secretId,
      runId: context?.runId ?? null,
      agentId: context?.agentId ?? null,
      outcome,
      // Redact defensively in case a future decrypt error ever echoes ciphertext.
      errorMessage: message == null ? null : redactPublicText(message),
      attemptedAt: this.now().toISOString(),
    })
  }
}

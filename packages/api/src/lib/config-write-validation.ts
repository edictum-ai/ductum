import type { ConfigResourceKind, ConfigResourceSpec } from '@ductum/core'

import { normalizeConfigResourceSpec } from './config-resources.js'
import { optionalRecord } from './http.js'
import { assertNoLiteralSecrets } from './literal-secrets.js'
import { assertKnownSecretRefs, type SecretLookup } from './secret-refs.js'

export function prepareConfigResourceSpecWrite(
  kind: ConfigResourceKind,
  value: unknown,
  secrets: SecretLookup,
  field = 'spec',
): ConfigResourceSpec {
  const spec = normalizeConfigResourceSpec(kind, value, field)
  assertKnownSecretRefs(spec, field, secrets)
  return spec
}

export function prepareAgentSpawnConfigWrite(
  value: unknown,
  secrets: SecretLookup,
  field = 'spawnConfig',
): Record<string, unknown> {
  const spawnConfig = optionalRecord(value, field) ?? {}
  assertNoLiteralSecrets(spawnConfig, field, 'Factory Settings.Agent')
  assertKnownSecretRefs(spawnConfig, field, secrets)
  return spawnConfig
}

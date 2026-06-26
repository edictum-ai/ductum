import { parseFactorySecretRef, type FactorySecretRepo } from '@ductum/core'

import { ValidationError } from './errors.js'

export type SecretLookup = Pick<FactorySecretRepo, 'getMetadata'>

export function assertKnownSecretRefs(value: unknown, field: string, secrets: SecretLookup): void {
  for (const ref of collectSecretRefs(value, field)) {
    if (secrets.getMetadata(ref.id) == null) {
      throw new ValidationError(`${ref.path} references unknown secret: ${ref.id}`)
    }
  }
}

function collectSecretRefs(value: unknown, path: string): Array<{ path: string; id: string }> {
  if (typeof value === 'string') {
    const id = parseFactorySecretRef(value)
    return id == null ? [] : [{ path, id }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSecretRefs(item, `${path}.${index}`))
  }
  if (value == null || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    collectSecretRefs(item, `${path}.${key}`),
  )
}

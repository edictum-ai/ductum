const SECRET_REF_PREFIX = 'secret:'

export function isFactorySecretRef(value: string): boolean {
  return parseFactorySecretRef(value) != null
}

export function parseFactorySecretRef(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith(SECRET_REF_PREFIX)) return null
  const target = trimmed.slice(SECRET_REF_PREFIX.length)
  return isValidSecretRefTarget(target) ? target : null
}

export function formatFactorySecretRef(id: string): string {
  if (!isValidSecretRefTarget(id)) throw new Error('Secret ref target must be a non-empty token')
  return `${SECRET_REF_PREFIX}${id}`
}

function isValidSecretRefTarget(value: string): boolean {
  return value.length > 0 && !/[\s"'`\\]/.test(value)
}

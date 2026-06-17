import { isFactorySecretRef } from './factory-secret-refs.js'

const REDACTED = '[redacted]'
const ENV_REFERENCE = /^\$\{[A-Z_][A-Z0-9_]*\}$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const GENERIC_TOKEN = /^[a-z0-9._~+=-]+$/i
const SAFE_PUBLIC_KEYS = new Set([
  'inputtokens',
  'maxtokens',
  'outputtokens',
  'tokencount',
  'tokens',
  'tokensin',
  'tokensout',
])
const SAFE_STATUS_VALUES = new Set([
  'configured',
  'disabled',
  'enabled',
  'invalid',
  'missing',
  'none',
  'not_applicable',
  'not_checked',
  'present',
  'ready',
  'skipped',
  'unavailable',
  'unknown',
  'valid',
])

const SECRET_VALUES = [
  /\bsk-[a-z0-9_-]{8,}\b/ig,
  /\bgh[pousr]_[a-z0-9_]{8,}\b/ig,
  /\bxox[baprs]-[a-z0-9_-]+\b/ig,
  /\b\d{5,}:[a-z0-9_-]{6,}\b/ig,
  /\b[a-z0-9]+(?:-[a-z0-9]+)*-secret(?:-[a-z0-9]+)*\b/ig,
  /\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/ig,
]

const BEARER_TOKEN = /\bBearer\s+[a-z0-9._~+/=-]+/ig
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/ig
const SENSITIVE_ASSIGNMENT =
  /\b([A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CREDENTIAL|ACCESS_KEY)[A-Z0-9_]*)=(\$\([^)]+\)|<[^>]+>|"[^"]*"|'[^']*'|[^\s;&|,)]+)/g
const URL_QUERY_PARAM = /([?&])([^=&#\s]+)=([^&#\s]+)/g
const YAML_KEY_VALUE = /^(\s*["']?([^:"'\n#]+)["']?\s*:\s*)(.+)$/gm

export function redactedPublicValue(): string {
  return REDACTED
}

export function redactPublicOutput<T>(value: T): T {
  return redactUnknown(value, undefined, false) as T
}

export function redactPublicSpawnConfig<T extends { env?: Record<string, string> }>(value: T): T {
  if (value.env == null) return value
  return {
    ...value,
    env: Object.fromEntries(
      Object.entries(value.env).map(([key, entry]) => [
        key,
        isSafeEnvReference(entry) || isFactorySecretRef(entry) ? entry : REDACTED,
      ]),
    ),
  }
}

export function publicOutputValue(fieldPath: string, value: unknown): string | null {
  if (value == null) return '(missing)'
  if (typeof value === 'string') {
    if (
      isSensitivePublicKey(fieldPath)
      && !isSafeEnvReference(value)
      && !isSafePublicReference(fieldPath, value)
    ) return REDACTED
    if (isSecretLookingValue(value)) return REDACTED
    const text = redactPublicText(value)
    return text.trim() === '' ? '(empty)' : text
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isSensitivePublicKey(fieldPath)) return REDACTED
  if (Array.isArray(value)) return `[${value.length} item${value.length === 1 ? '' : 's'}]`
  return '[object]'
}

export function redactPublicText(value: string): string {
  if (isFactorySecretRef(value.trim())) return value
  return redactYamlKeyValues(
    SECRET_VALUES.reduce(
      (text, pattern) => text.replace(pattern, REDACTED),
      value
        .replace(URL_PASSWORD, `$1$2:${REDACTED}@`)
        .replace(URL_QUERY_PARAM, (match, prefix: string, key: string) =>
          isSensitiveQueryKey(key) ? `${prefix}${key}=${REDACTED}` : match)
        .replace(BEARER_TOKEN, `Bearer ${REDACTED}`)
        .replace(SENSITIVE_ASSIGNMENT, (match, key, raw: string) =>
          isSafePublicReference(key, stripQuotes(raw)) ? match : `${key}=${REDACTED}`),
    ),
  )
}

export function isSecretLookingValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed === '' || isSafeEnvReference(trimmed)) return false
  if (redactPublicText(trimmed) !== trimmed) return true
  return looksLikeGenericToken(trimmed)
}

export function isSensitivePublicKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  const segments = key
    .split(/[^a-zA-Z0-9]+/)
    .map((segment) => segment.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
  return isSensitiveCompactKey(compact) || segments.some(isSensitiveCompactKey)
}

export function isSafeEnvReference(value: string): boolean {
  return ENV_REFERENCE.test(value.trim())
}

export function isSafeEnvName(value: string): boolean {
  return ENV_NAME.test(value.trim())
}

function isSensitiveCompactKey(compact: string): boolean {
  if (SAFE_PUBLIC_KEYS.has(compact)) return false
  return compact.includes('password')
    || compact.includes('secret')
    || compact.includes('token')
    || compact.includes('apikey')
    || compact.includes('accesskey')
    || compact.includes('privatekey')
    || compact.includes('credential')
    || compact.includes('ciphertext')
    || compact === 'authtag'
    || compact === 'keyid'
    || compact === 'keysource'
    || compact === 'authheader'
    || compact === 'accessref'
    || compact === 'auth'
    || compact === 'authorization'
    || compact.endsWith('authtoken')
    || compact.endsWith('oauth')
}

function redactUnknown(value: unknown, key: string | undefined, parentSensitive: boolean): unknown {
  const keySensitive = key != null && isSensitivePublicKey(key)
  if (typeof value === 'string') {
    if ((keySensitive || parentSensitive) && !isSafePublicReference(key, value)) return REDACTED
    return redactPublicText(value)
  }
  if (value == null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, key, keySensitive || parentSensitive))
  const childParentSensitive = parentSensitive || (key != null && isSensitiveContainerKey(key))
  const record = value as Record<string, unknown>
  const redacted = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      redactUnknown(child, childKey, childParentSensitive),
    ]),
  )
  if (hasSensitiveFieldContext(record)) {
    redacted.value = redactUnknown(record.value, 'value', true)
  }
  return redacted
}

function redactYamlKeyValues(text: string): string {
  return text.replace(YAML_KEY_VALUE, (line, prefix: string, key: string, raw: string) => {
    const cleanKey = key.trim()
    if (/\s{2,}/.test(cleanKey) || !isSensitivePublicKey(cleanKey)) return line
    const value = stripQuotes(raw.trim())
    return value === '' || isSafePublicReference(cleanKey, value) ? line : `${prefix}${REDACTED}`
  })
}

function looksLikeGenericToken(value: string): boolean {
  if (value.length < 32 || !GENERIC_TOKEN.test(value)) return false
  if (/[\\/]/.test(value) || /\.[a-z0-9]{1,12}$/i.test(value)) return false
  const classes = [/[a-z]/.test(value), /[A-Z]/.test(value), /\d/.test(value)].filter(Boolean)
  return classes.length >= 2
}

function isSensitiveContainerKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return compact === 'credential'
    || compact === 'credentials'
    || compact === 'secret'
    || compact === 'secrets'
    || compact === 'auth'
    || compact.endsWith('oauth')
}

function isSensitiveQueryKey(key: string): boolean {
  const normalized = safeDecodeURIComponent(key).toLowerCase().replace(/[^a-z0-9]/g, '')
  return isSensitiveCompactKey(normalized)
}

function isSafePublicReference(key: string | undefined, value: string): boolean {
  return isSafeEnvReference(value)
    || isFactorySecretRef(value)
    || isSafeInstructionValue(value)
    || isSafePublicStatus(value)
    || (key != null && isEnvMetadataKey(key) && isSafeEnvName(value))
}

function isEnvMetadataKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return compact === 'envvar'
    || compact === 'envvars'
    || compact === 'envname'
    || compact === 'environmentvariable'
    || compact === 'environmentvariablename'
    || compact.endsWith('envvar')
    || compact.endsWith('envname')
}

function isSafePublicStatus(value: string): boolean {
  return SAFE_STATUS_VALUES.has(value.trim().toLowerCase())
}

function isSafeInstructionValue(value: string): boolean {
  const trimmed = value.trim()
  return /<[^>]+>/.test(trimmed)
    || /\$\([^)]+\)/.test(trimmed)
    || /^missing\s+\([A-Z_][A-Z0-9_]*\)$/i.test(trimmed)
    || /^use\s+--[a-z0-9-]+\s+or\s+set\s+[A-Z_][A-Z0-9_]*$/i.test(trimmed)
    || /\bgrep\s+\^?[A-Z_][A-Z0-9_]*\b/.test(trimmed)
}

function hasSensitiveFieldContext(record: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, 'value')) return false
  return ['path', 'label', 'name', 'field', 'key'].some((contextKey) => {
    const value = record[contextKey]
    return typeof value === 'string' && isSensitivePublicKey(value)
  })
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

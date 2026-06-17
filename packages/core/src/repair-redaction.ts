import {
  isSecretLookingValue,
  isSensitivePublicKey,
  publicOutputValue,
  redactPublicText,
} from './public-redaction.js'

export function safeRepairValue(fieldPath: string, value: unknown): string | null {
  return publicOutputValue(fieldPath, value)
}

export function safeRepairText(value: string): string {
  return redactPublicText(value)
}

export { isSecretLookingValue, isSensitivePublicKey as isSensitiveKey }

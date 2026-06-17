import type { ConfigResourceKind, ConfigResourceSpec } from '@ductum/core'

import { ValidationError } from './errors.js'
import {
  assertCommandHasNoLiteralSecrets,
  assertEnvReferenceString,
  assertNoLiteralSecrets,
} from './literal-secrets.js'

export const CONFIG_RESOURCE_KINDS = [
  'WorkflowProfile',
  'Model',
  'Harness',
  'SandboxProfile',
  'NotificationChannel',
] as const

const CONFIG_RESOURCE_KIND_SET = new Set<string>(CONFIG_RESOURCE_KINDS)

export function parseConfigResourceKind(value: string): ConfigResourceKind {
  if (!CONFIG_RESOURCE_KIND_SET.has(value)) {
    throw new ValidationError(`kind must be one of: ${CONFIG_RESOURCE_KINDS.join(', ')}`)
  }
  return value as ConfigResourceKind
}

export function normalizeConfigResourceSpec(kind: ConfigResourceKind, value: unknown, field = 'spec'): ConfigResourceSpec {
  const raw = requireRecord(value, field)
  switch (kind) {
    case 'WorkflowProfile':
      return {
        path: requireString(raw.path, `${field}.path`),
        ...optionalStringField(raw.description, 'description', `${field}.description`),
      }
    case 'Model':
      return {
        provider: requireString(raw.provider, `${field}.provider`),
        modelId: requireString(raw.modelId, `${field}.modelId`),
        ...modelAccessRefField(raw.accessRef, `${field}.accessRef`),
        ...optionalStringArrayField(raw.supportedEfforts, 'supportedEfforts', `${field}.supportedEfforts`),
      }
    case 'Harness':
      assertCommandHasNoLiteralSecrets(optionalStringValue(raw.command, `${field}.command`), `${field}.command`, 'Factory Settings.Harness')
      assertCommandHasNoLiteralSecrets(optionalStringValue(raw.testCommand, `${field}.testCommand`), `${field}.testCommand`, 'Factory Settings.Harness')
      return {
        type: requireString(raw.type, `${field}.type`),
        ...optionalStringField(raw.command, 'command', `${field}.command`),
        ...optionalStringField(raw.runtime, 'runtime', `${field}.runtime`),
        ...optionalStringField(raw.controlMode, 'controlMode', `${field}.controlMode`),
        ...optionalStringArrayField(raw.supportedSandboxes, 'supportedSandboxes', `${field}.supportedSandboxes`),
        ...optionalStringArrayField(raw.supportedProviders, 'supportedProviders', `${field}.supportedProviders`),
        ...optionalSecretRefsField(raw.requiredSecretRefs, 'requiredSecretRefs', `${field}.requiredSecretRefs`),
        ...optionalStringField(raw.restartBehavior, 'restartBehavior', `${field}.restartBehavior`),
        ...optionalStringField(raw.testCommand, 'testCommand', `${field}.testCommand`),
      }
    case 'SandboxProfile':
      assertNoLiteralSecrets(raw.credentials, `${field}.credentials`, 'Factory Settings.SandboxProfile', { secretContainer: true })
      return {
        provider: requireString(raw.provider, `${field}.provider`),
        mode: requireString(raw.mode, `${field}.mode`),
        ...optionalRecordField(raw.filesystem, 'filesystem', `${field}.filesystem`),
        ...optionalRecordField(raw.network, 'network', `${field}.network`),
        ...optionalRecordField(raw.credentials, 'credentials', `${field}.credentials`),
        ...optionalRecordField(raw.resources, 'resources', `${field}.resources`),
        ...optionalRecordField(raw.process, 'process', `${field}.process`),
      }
    case 'NotificationChannel':
      if (raw.events != null) {
        throw new ValidationError(`${field}.events is not supported for NotificationChannel`)
      }
      if (requireString(raw.backend, `${field}.backend`) !== 'telegram') {
        throw new ValidationError(`${field}.backend must be telegram`)
      }
      return {
        backend: 'telegram',
        ...notificationConfigField(raw.config, `${field}.config`),
      }
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`)
  }
  return value
}

function optionalStringField(value: unknown, key: string, field: string): Record<string, string> {
  const text = optionalStringValue(value, field)
  if (text == null) return {}
  return text.trim() === '' ? {} : { [key]: text }
}

function optionalStringValue(value: unknown, field: string): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`)
  return value
}

function modelAccessRefField(value: unknown, field: string): Record<string, string> {
  const text = optionalStringValue(value, field)
  assertEnvReferenceString(text, field, 'Factory Settings.Model')
  return text == null || text.trim() === '' ? {} : { accessRef: text }
}

function notificationConfigField(value: unknown, field: string): Record<string, Record<string, unknown>> {
  assertNoLiteralSecrets(value, field, 'Factory Settings.NotificationChannel')
  return optionalRecordField(value, 'config', field)
}

function optionalStringArrayField(value: unknown, key: string, field: string): Record<string, string[]> {
  if (value == null) return {}
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${field} must be an array of strings`)
  }
  return { [key]: value }
}

function optionalSecretRefsField(value: unknown, key: string, field: string): Record<string, string[]> {
  if (value == null) return {}
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${field} must be an array of strings`)
  }
  value.forEach((item, index) =>
    assertEnvReferenceString(item as string, `${field}.${index}`, 'Factory Settings.Harness'),
  )
  return { [key]: value as string[] }
}

function optionalRecordField(value: unknown, key: string, field: string): Record<string, Record<string, unknown>> {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`)
  }
  return { [key]: value as Record<string, unknown> }
}

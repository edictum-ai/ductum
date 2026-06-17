import type { ConfigResource, ConfigResourceRepo, NotificationChannelSpec } from '@ductum/core'

import { ValidationError } from './errors.js'

type ConfigResourceLookup = Pick<ConfigResourceRepo, 'get' | 'list'>

export function resolveNotificationChannelResource(
  ref: string,
  resources: ConfigResourceLookup,
): ConfigResource {
  const byId = resources.get(ref as ConfigResource['id'])
  if (byId != null) return assertNotificationChannel(ref, byId)

  const named = resources.list().filter((resource) => resource.name === ref)
  const matchingKind = named.filter((resource) => resource.kind === 'NotificationChannel')
  const factoryMatches = matchingKind.filter((resource) => resource.projectId == null)
  if (factoryMatches.length === 1) return factoryMatches[0]!
  if (matchingKind.length > 1) {
    throw new ValidationError(`telegram.channelRef "${ref}" is ambiguous`)
  }
  if (matchingKind.length === 1) {
    throw new ValidationError(`telegram.channelRef "${ref}" references a project-scoped NotificationChannel; expected factory-scoped NotificationChannel`)
  }

  const wrongKind = named[0]
  if (wrongKind != null) {
    throw new ValidationError(`telegram.channelRef "${ref}" references ${wrongKind.kind}, expected NotificationChannel`)
  }

  throw new ValidationError(`Notification channel not found: ${ref}`)
}

export function assertTelegramChannel(resource: ConfigResource): NotificationChannelSpec {
  const spec = resource.spec as Partial<NotificationChannelSpec>
  const backend = cleanString(spec.backend)
  if (backend !== 'telegram') {
    throw new ValidationError(`NotificationChannel ${resource.name} has backend "${backend ?? 'missing'}"; expected telegram`)
  }
  return {
    backend,
    ...(spec.config == null ? {} : { config: spec.config }),
  }
}

function assertNotificationChannel(ref: string, resource: ConfigResource): ConfigResource {
  if (resource.kind !== 'NotificationChannel') {
    throw new ValidationError(`telegram.channelRef "${ref}" references ${resource.kind}, expected NotificationChannel`)
  }
  if (resource.projectId != null) {
    throw new ValidationError(`telegram.channelRef "${ref}" references a project-scoped NotificationChannel; expected factory-scoped NotificationChannel`)
  }
  return resource
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

import type { Hono } from 'hono'
import type {
  FactoryRuntimePatch,
  FactoryRuntimePersistedSettings,
  FactorySettingsAffectedRuntime,
  FactorySettingsCostBudgetInput,
} from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalNumber, optionalRecord, optionalString, readJson } from '../lib/http.js'
import {
  affectedRuntimesForPatch,
  buildFactoryRuntimeSettings,
  buildFactorySettingsDetails,
  normalizeCostBudget,
  runtimeDesired,
  runtimeWriteResult,
  settingsWriteResult,
} from '../lib/factory-settings-api.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { publicOutput } from '../lib/public-output.js'

// CONFIG_WRITE_VALIDATION_EXEMPTION: Runtime/settings writes do not persist operator-supplied secret-bearing fields.

const SETTINGS_FIELDS = ['name', 'defaultMergeMode', 'heartbeatTimeoutSeconds', 'budgets'] as const
const RUNTIME_FIELDS = [
  'apiBindHost',
  'apiPort',
  'publicApiUrl',
  'dashboardUrl',
  'dispatcherEnabled',
  'dispatcherHeartbeatIntervalSeconds',
  'worktreeEnabled',
  'worktreeBasePath',
] as const

export function registerFactoryRuntimeRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory/settings', (c) => c.json(publicOutput(buildFactorySettingsDetails(context))))

  app.patch('/api/factory/settings', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    rejectUnknown(body, SETTINGS_FIELDS, 'Factory Settings')
    const factory = context.repos.factory.get()
    if (factory == null) throw new NotFoundError('Factory not found')
    const before = buildFactorySettingsDetails(context)
    const defaultMergeMode = mergeMode(body.defaultMergeMode, 'defaultMergeMode') ?? factory.config.defaultMergeMode
    const heartbeatTimeoutSeconds = positiveNumber(
      optionalNumber(body.heartbeatTimeoutSeconds, 'heartbeatTimeoutSeconds')
        ?? factory.config.heartbeatTimeoutSeconds,
      'heartbeatTimeoutSeconds',
    )
    const costBudget = body.budgets === undefined
      ? normalizeCostBudget(factory.config.costBudget)
      : mergeBudget(normalizeCostBudget(factory.config.costBudget), budgetPatch(body.budgets))
    const changedFields = Object.keys(body).sort()
    const affectedRuntimes: FactorySettingsAffectedRuntime[] = []
    if (
      body.heartbeatTimeoutSeconds !== undefined &&
      heartbeatTimeoutSeconds !== before.heartbeatTimeoutSeconds
    ) {
      if (context.setHeartbeatTimeoutSeconds == null) affectedRuntimes.push('dispatcher' as const)
    }
    const result = context.db.transaction(() => {
      context.repos.factory.update(factory.id, {
        name: optionalString(body.name, 'name') ?? factory.name,
        config: {
          ...factory.config,
          defaultMergeMode,
          heartbeatTimeoutSeconds,
          costBudget,
        },
      })
      const desired = buildFactorySettingsDetails(context)
      const current = affectedRuntimes.length === 0
        ? desired
        : { ...desired, heartbeatTimeoutSeconds: before.heartbeatTimeoutSeconds }
      const write = settingsWriteResult(current, desired, {
        applied: affectedRuntimes.length === 0,
        restartRequired: affectedRuntimes.length > 0,
        affectedRuntimes,
      })
      recordAuditEvent(context, {
        eventType: 'settings.factory.updated',
        status: affectedRuntimes.length === 0 ? 'applied' : 'restart_required',
        title: 'Factory settings updated',
        summary: changedFields.join(', '),
        metadata: { changedFields, affectedRuntimes },
      })
      return write
    })()
    if (body.budgets !== undefined) applyBudget(context.costBudget, costBudget)
    if (
      body.heartbeatTimeoutSeconds !== undefined &&
      heartbeatTimeoutSeconds !== before.heartbeatTimeoutSeconds &&
      context.setHeartbeatTimeoutSeconds != null
    ) {
      context.setHeartbeatTimeoutSeconds(heartbeatTimeoutSeconds)
    }
    return c.json(publicOutput(result))
  })

  app.get('/api/factory/runtime', (c) => c.json(publicOutput(buildFactoryRuntimeSettings(context))))

  app.patch('/api/factory/runtime', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    rejectUnknown(body, RUNTIME_FIELDS, 'Factory Runtime')
    const factory = context.repos.factory.get()
    if (factory == null) throw new NotFoundError('Factory not found')
    const patch = runtimePatch(body)
    const before = buildFactoryRuntimeSettings(context).current
    const changedFields = Object.keys(body).sort()
    const result = context.db.transaction(() => {
      context.repos.runtimeSettings.upsert(factory.id, patch)
      const desired = runtimeDesired(context, factory.id)
      const affectedRuntimes = affectedRuntimesForPatch(before, desired, patch)
      const write = runtimeWriteResult(before, desired, affectedRuntimes)
      recordAuditEvent(context, {
        eventType: 'settings.runtime.updated',
        status: affectedRuntimes.length === 0 ? 'applied' : 'restart_required',
        title: 'Factory runtime settings updated',
        summary: changedFields.join(', '),
        metadata: { changedFields, affectedRuntimes },
      })
      return write
    })()
    return c.json(publicOutput(result))
  })
}

function runtimePatch(body: Record<string, unknown>): FactoryRuntimePatch {
  return {
    ...nullableStringField(body, 'apiBindHost'),
    ...nullableNumberField(body, 'apiPort'),
    ...nullableStringField(body, 'publicApiUrl'),
    ...nullableStringField(body, 'dashboardUrl'),
    ...nullableBooleanField(body, 'dispatcherEnabled'),
    ...nullableNumberField(body, 'dispatcherHeartbeatIntervalSeconds'),
    ...nullableBooleanField(body, 'worktreeEnabled'),
    ...nullableStringField(body, 'worktreeBasePath'),
  }
}

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(body).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) throw new ValidationError(`${label} fields are not supported: ${unknown.join(', ')}`)
}

function mergeMode(value: unknown, field: string) {
  if (value === undefined || value === null) return undefined
  if (value !== 'auto' && value !== 'human') throw new ValidationError(`${field} must be auto or human`)
  return value
}

function nullableStringField<T extends keyof FactoryRuntimePersistedSettings>(
  body: Record<string, unknown>,
  field: T,
): FactoryRuntimePatch {
  if (body[field] === undefined) return {}
  if (body[field] === null) return { [field]: null }
  return { [field]: optionalString(body[field], field) ?? null }
}

function nullableNumberField<T extends keyof FactoryRuntimePersistedSettings>(
  body: Record<string, unknown>,
  field: T,
): FactoryRuntimePatch {
  if (body[field] === undefined) return {}
  if (body[field] === null) return { [field]: null }
  return { [field]: optionalNumber(body[field], field) ?? null }
}

function nullableBooleanField<T extends keyof FactoryRuntimePersistedSettings>(
  body: Record<string, unknown>,
  field: T,
): FactoryRuntimePatch {
  if (body[field] === undefined) return {}
  if (body[field] === null) return { [field]: null }
  if (typeof body[field] !== 'boolean') throw new ValidationError(`${field} must be a boolean`)
  return { [field]: body[field] }
}

function budgetPatch(value: unknown): FactorySettingsCostBudgetInput {
  const body = optionalRecord(value, 'budgets') ?? {}
  rejectUnknown(body, ['perRunWarnUsd', 'perRunHardUsd', 'perSpecHardUsd'], 'Budget')
  return {
    ...budgetNumber(body.perRunWarnUsd, 'budgets.perRunWarnUsd'),
    ...budgetNumber(body.perRunHardUsd, 'budgets.perRunHardUsd'),
    ...budgetNumber(body.perSpecHardUsd, 'budgets.perSpecHardUsd'),
  }
}

function budgetNumber(value: unknown, field: string) {
  if (value === undefined) return {}
  if (value === null) return { [field.split('.').at(-1)!]: null }
  const parsed = optionalNumber(value, field)
  if (parsed == null) return {}
  if (!Number.isFinite(parsed) || parsed < 0) throw new ValidationError(`${field} must be a non-negative number`)
  return { [field.split('.').at(-1)!]: parsed }
}

function mergeBudget(
  current: FactorySettingsCostBudgetInput,
  patch: FactorySettingsCostBudgetInput,
): FactorySettingsCostBudgetInput {
  return { ...current, ...patch }
}

function applyBudget(target: ApiContext['costBudget'], next: FactorySettingsCostBudgetInput): void {
  for (const key of ['perRunWarnUsd', 'perRunHardUsd', 'perSpecHardUsd'] as const) {
    const value = next[key]
    if (typeof value === 'number') target[key] = value
    else delete target[key]
  }
}

function positiveNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`${field} must be a positive number`)
  return value
}

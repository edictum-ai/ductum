import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { Hono } from 'hono'
import type { DispatcherStatus } from '@ductum/core'
import {
  buildFactoryDoctorReport,
  buildFactorySettingsCatalogs,
  createId,
  type FactoryDoctorCheck,
  type ProjectAgent,
} from '@ductum/core'

import type { ApiContext } from '../lib/deps.js'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js'
import { optionalRecord, optionalString, readJson } from '../lib/http.js'
import { buildOperatorBrief } from '../lib/operator-brief.js'
import { buildExecutionIntegrityReport } from '../lib/execution-integrity.js'
import { publicOutput } from '../lib/public-output.js'

const DEFAULT_FACTORY_CONFIG = {
  heartbeatTimeoutSeconds: 120,
  defaultMergeMode: 'human' as const,
}
const MAX_HOME_LAST_SEEN_FUTURE_SKEW_MS = 5 * 60 * 1000

export function registerFactoryRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory', (c) => {
    const factory = context.repos.factory.get()
    if (factory == null) {
      return c.json(publicOutput({ error: 'Factory not found' }), 404)
    }
    return c.json(publicOutput(factory))
  })

  app.put('/api/factory', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const existing = context.repos.factory.get()
    const config = optionalRecord(body.config, 'config') ?? DEFAULT_FACTORY_CONFIG

    if (existing == null) {
      const created = context.repos.factory.create({
        id: createId<'FactoryId'>(),
        name: optionalString(body.name, 'name') ?? 'Ductum',
        config: {
          ...DEFAULT_FACTORY_CONFIG,
          ...config,
          heartbeatTimeoutSeconds:
            typeof config.heartbeatTimeoutSeconds === 'number'
              ? config.heartbeatTimeoutSeconds
              : DEFAULT_FACTORY_CONFIG.heartbeatTimeoutSeconds,
          defaultMergeMode:
            config.defaultMergeMode === 'auto' || config.defaultMergeMode === 'human'
              ? config.defaultMergeMode
              : DEFAULT_FACTORY_CONFIG.defaultMergeMode,
        },
      })
      return c.json(publicOutput(created), 201)
    }

    return c.json(
      publicOutput(context.repos.factory.update(existing.id, {
        name: optionalString(body.name, 'name') ?? existing.name,
        config: {
          ...existing.config,
          ...config,
          heartbeatTimeoutSeconds:
            typeof config.heartbeatTimeoutSeconds === 'number'
              ? config.heartbeatTimeoutSeconds
              : existing.config.heartbeatTimeoutSeconds,
          defaultMergeMode:
            config.defaultMergeMode === 'auto' || config.defaultMergeMode === 'human'
              ? config.defaultMergeMode
            : existing.config.defaultMergeMode,
        },
      })),
    )
  })

  app.get('/api/factory/dispatcher', (c) => {
    return c.json(publicOutput(resolveDispatcherStatus(context)))
  })

  // Decision 120 (P3.4): expose the live cost-budget caps so dashboards
  // and CLI surfaces can render projected vs cap before the hard cap
  // bites. The values reflect the in-memory `context.costBudget`, which
  // includes the D120 default of $200/spec when Factory Settings leave the
  // field unset.
  app.get('/api/factory/cost-budget', (c) => {
    return c.json(publicOutput({
      perRunWarnUsd: context.costBudget.perRunWarnUsd ?? null,
      perRunHardUsd: context.costBudget.perRunHardUsd ?? null,
      perSpecHardUsd: context.costBudget.perSpecHardUsd ?? null,
    }))
  })

  app.get('/api/factory/operator-brief', (c) => {
    return c.json(publicOutput(buildOperatorBrief(context, { now: context.now() })))
  })

  app.get('/api/factory/doctor', (c) => {
    const catalogs = buildApiFactoryDoctorCatalogs(context)
    return c.json(publicOutput(buildFactoryDoctorReport({
      catalogs,
      agents: context.repos.agents.list(),
      assignments: listAllProjectAgents(context),
      secrets: context.repos.secrets.list(),
      env: process.env,
      authProbe: factoryDoctorAuthProbe,
      liveSmoke: c.req.query('liveSmoke') === '1' || c.req.query('liveSmoke') === 'true',
    })))
  })

  app.get('/api/factory/home-view-state', (c) => {
    const factory = requireFactory(context)
    return c.json(publicOutput(context.repos.factoryViewState.get(factory.id) ?? {
      factoryId: factory.id,
      homeLastSeenAt: null,
      createdAt: null,
      updatedAt: null,
    }))
  })

  app.put('/api/factory/home-view-state', async (c) => {
    const factory = requireFactory(context)
    const body = optionalRecord(await readJson<unknown>(c), 'body') ?? {}
    return c.json(publicOutput(context.repos.factoryViewState.upsert(factory.id, {
      homeLastSeenAt: optionalIsoTimestamp(body.homeLastSeenAt, 'homeLastSeenAt', context.now()),
    })))
  })

  app.get('/api/factory/execution-integrity', (c) => {
    return c.json(publicOutput(buildExecutionIntegrityReport(context)))
  })

  app.post('/api/factory/dispatcher/cycle', async (c) => {
    const status = resolveDispatcherStatus(context)
    if (!status.enabled) {
      throw new ConflictError(dispatcherCycleUnavailable(status.reason ?? 'dispatch is disabled'))
    }
    if (context.cycleDispatcher == null) {
      throw new ConflictError(dispatcherCycleUnavailable('dispatcher support not loaded'))
    }
    return c.json(publicOutput(await context.cycleDispatcher()))
  })

  // Manual worktree cleanup — removes any worktree dir whose run is
  // not currently in an active session. Safe to call at any time.
  app.post('/api/factory/cleanup-worktrees', async (c) => {
    if (context.cleanupWorktrees == null) {
      return c.json(publicOutput({ removed: 0, reason: 'cleanup not available (dispatcher not loaded)' }))
    }
    const removed = await context.cleanupWorktrees()
    return c.json(publicOutput({ removed }))
  })
}

function requireFactory(context: ApiContext) {
  const factory = context.repos.factory.get()
  if (factory == null) throw new NotFoundError('Factory not found')
  return factory
}

function optionalIsoTimestamp(value: unknown, field: string, now: Date): string | null {
  if (value === null) return null
  const timestamp = optionalString(value, field)
  const parsed = timestamp == null ? null : new Date(timestamp)
  if (timestamp == null || parsed == null || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new ValidationError(`${field} must be an ISO timestamp or null`)
  }
  if (parsed.getTime() > now.getTime() + MAX_HOME_LAST_SEEN_FUTURE_SKEW_MS) {
    throw new ValidationError(`${field} cannot be in the future`)
  }
  return timestamp
}

function resolveDispatcherStatus(context: ApiContext): DispatcherStatus {
  if (context.getDispatcherStatus == null) {
    return disabledDispatcherStatus(context.repos.runs.getActive().length, 'dispatcher support not loaded')
  }
  const status = context.getDispatcherStatus()
  return status.enabled ? { ...status, reason: status.reason ?? null } : { ...status, reason: status.reason ?? 'dispatch disabled' }
}

function disabledDispatcherStatus(activeRuns: number, reason: string): DispatcherStatus {
  return {
    running: false,
    activeRuns,
    maxConcurrentRuns: 0,
    lastCycleAt: null,
    enabled: false,
    adapterCount: 0,
    adapters: [],
    reason,
  }
}

function dispatcherCycleUnavailable(reason: string): string {
  return `Dispatcher cycle unavailable — ${reason}`
}

function buildApiFactoryDoctorCatalogs(context: ApiContext) {
  return buildFactorySettingsCatalogs({
    factory: context.repos.factory.get(),
    configResources: context.repos.configResources.list(),
    agents: context.repos.agents.list(),
    costBudget: context.costBudget,
  })
}

function listAllProjectAgents(context: ApiContext): ProjectAgent[] {
  const factory = context.repos.factory.get()
  if (factory == null) return []
  return context.repos.projects.list(factory.id).flatMap((project) => context.repos.projectAgents.list(project.id))
}

function factoryDoctorAuthProbe(input: {
  providerId: string
  harnessType: string
  command?: string
}): FactoryDoctorCheck | null {
  if (input.providerId === 'openai') {
    if (input.harnessType !== 'codex-sdk' && input.harnessType !== 'codex-app-server') return null
    const command = firstCommandToken(input.command) ?? 'codex'
    try {
      execFileSync(command, ['login', 'status'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5_000,
      })
      return { kind: 'auth', status: 'ready', message: 'Codex login status is active', refs: [command] }
    } catch {
      return null
    }
  }
  if (input.providerId === 'github-copilot') {
    if (input.harnessType !== 'copilot-sdk') return null
    try {
      execFileSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 5_000,
      })
      return { kind: 'auth', status: 'ready', message: 'GitHub CLI auth status is active for Copilot', refs: ['gh auth status'] }
    } catch {
      return copilotGhHostsFileExists()
        ? { kind: 'auth', status: 'ready', message: 'GitHub CLI hosts file is present for Copilot', refs: ['gh hosts file'] }
        : null
    }
  }
  return null
}

function firstCommandToken(command: string | undefined): string | null {
  const trimmed = command?.trim()
  if (trimmed == null || trimmed === '') return null
  return trimmed.split(/\s+/)[0] ?? null
}

function copilotGhHostsFileExists(): boolean {
  const home = process.env.HOME?.trim() || homedir()
  return existsSync(join(home, '.config', 'gh', 'hosts.yml'))
}

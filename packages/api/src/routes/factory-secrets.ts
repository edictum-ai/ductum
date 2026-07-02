import {
  createId,
  encryptFactorySecret,
  formatFactorySecretRef,
  FactorySecretResolver,
  loadFactorySecretKey,
  repositoryFromTarget,
  type FactorySecretMetadata,
  type FactorySecretScope,
  type FactorySecretStoredRecord,
  type ProjectId,
  type Repository,
  type RunId,
} from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotFoundError, ValidationError } from '../lib/errors.js'
import { testGitHubAppSecretIfPresent } from '../lib/github-auth.js'
import { parseGitHubRepoRef, toGitHubApiBaseUrl } from '../lib/github-ref.js'
import { optionalString, readJson, requireString } from '../lib/http.js'
import { recordAuditEvent } from '../lib/audit-log.js'
import { publicOutput, publicSecretAccessEvent } from '../lib/public-output.js'

// CONFIG_WRITE_VALIDATION_EXEMPTION: This route is the encrypted secret store itself, not a normal config path.

export function registerFactorySecretRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory/secrets', (c) => {
    const projectId = c.req.query('projectId')
    return c.json(publicOutput(context.repos.secrets.list({
      ...(projectId == null ? {} : { projectId: projectId === 'factory' ? null : projectId as never }),
    })))
  })

  app.get('/api/factory/secrets/:id', (c) => {
    const record = context.repos.secrets.getMetadata(c.req.param('id'))
    if (record == null) throw new NotFoundError(`Secret not found: ${c.req.param('id')}`)
    return c.json(publicOutput(record))
  })

  app.post('/api/factory/secrets', async (c) => {
    const body = await readJson<Record<string, unknown>>(c)
    const scope = secretScope(context, body)
    const encrypted = encryptFactorySecret(
      requireString(body.value, 'value'),
      loadFactorySecretKey(requireFactoryDir(context)),
    )
    const record = context.db.transaction(() => {
      const created = context.repos.secrets.create({
        id: createId<'FactorySecretId'>(),
        name: requireString(body.name, 'name'),
        scope: scope.scope,
        projectId: scope.projectId,
        description: nullableString(body.description, 'description') ?? null,
        status: 'configured',
        keySource: encrypted.keySource,
        payload: encrypted.payload,
        lastRotatedAt: context.now().toISOString(),
        lastTestedAt: null,
      })
      recordSecretAudit(context, 'settings.secret.created', created, 'Factory secret created')
      return created
    })()
    return c.json(publicOutput(metadata(record)), 201)
  })

  app.patch('/api/factory/secrets/:id', async (c) => {
    const id = c.req.param('id')
    const body = await readJson<Record<string, unknown>>(c)
    const update: Parameters<ApiContext['repos']['secrets']['update']>[1] = {}
    if (body.name !== undefined) update.name = requireString(body.name, 'name')
    if (body.description !== undefined) update.description = nullableString(body.description, 'description')
    if (body.value !== undefined) {
      const encrypted = encryptFactorySecret(
        requireString(body.value, 'value'),
        loadFactorySecretKey(requireFactoryDir(context)),
      )
      update.keySource = encrypted.keySource
      update.payload = encrypted.payload
      update.status = 'configured'
      update.lastRotatedAt = context.now().toISOString()
    }
    const record = context.db.transaction(() => {
      const updated = context.repos.secrets.update(id, update)
      recordSecretAudit(context, 'settings.secret.updated', updated, 'Factory secret updated')
      return updated
    })()
    return c.json(publicOutput(metadata(record)))
  })

  app.delete('/api/factory/secrets/:id', (c) => {
    const id = c.req.param('id')
    const record = context.repos.secrets.get(id)
    context.db.transaction(() => {
      context.repos.secrets.delete(id)
      if (record != null) {
        recordSecretAudit(context, 'settings.secret.deleted', record, 'Factory secret deleted', 'deleted')
      }
    })()
    return c.body(null, 204)
  })

  app.post('/api/factory/secrets/:id/test', async (c) => {
    const id = c.req.param('id')
    const value = new FactorySecretResolver({
      factoryDir: requireFactoryDir(context),
      secrets: context.repos.secrets,
      accessLog: context.repos.secretAccessLog,
      now: context.now,
    }).resolve(`secret:${id}`)
    try {
      const targets = githubAppSecretTestTargets(context, id)
      for (const apiBaseUrl of targets.apiBaseUrls) {
        const result = await testGitHubAppSecretIfPresent(value, apiBaseUrl)
        if (targets.requiresGitHubApp && !result.tested) {
          throw new ValidationError('repository.authRef linked secrets must be GitHub App secrets')
        }
      }
    } catch (error) {
      context.db.transaction(() => {
        const failed = context.repos.secrets.updateMetadata(id, {
          status: 'test_failed',
          lastTestedAt: null,
        })
        recordSecretAudit(context, 'settings.secret.tested', failed, 'Factory secret test failed', 'failure')
      })()
      throw error
    }
    const record = context.db.transaction(() => {
      const tested = context.repos.secrets.updateMetadata(id, {
        status: 'configured',
        lastTestedAt: context.now().toISOString(),
      })
      recordSecretAudit(context, 'settings.secret.tested', tested, 'Factory secret tested', 'success')
      return tested
    })()
    return c.json(publicOutput(metadata(record)))
  })

  // P1 / issue #210: read-only access history for a single secret. Returns
  // value-free events (secret ref, run/agent id when known, outcome, timestamp,
  // sanitized error) so the dashboard can show "who resolved this and when"
  // without ever exposing plaintext or encrypted material.
  app.get('/api/factory/secrets/:id/access-history', (c) => {
    const id = c.req.param('id')
    if (context.repos.secrets.getMetadata(id) == null) {
      throw new NotFoundError(`Secret not found: ${id}`)
    }
    const limit = parseHistoryLimit(c.req.query('limit'))
    return c.json(publicOutput(context.repos.secretAccessLog.listBySecret(id, limit).map(publicSecretAccessEvent)))
  })

  // P1 / issue #210: read-only access history scoped by run. Same value-free
  // shape as the secret-scoped route; used by the run detail panel.
  app.get('/api/runs/:id/secret-access-history', (c) => {
    const runId = c.req.param('id') as RunId
    if (context.repos.runs.get(runId) == null) {
      throw new NotFoundError(`Run not found: ${c.req.param('id')}`)
    }
    const limit = parseHistoryLimit(c.req.query('limit'))
    return c.json(publicOutput(context.repos.secretAccessLog.listByRun(runId, limit).map(publicSecretAccessEvent)))
  })
}

function parseHistoryLimit(raw: string | undefined): number {
  if (raw == null || raw === '') return 100
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 100
  return Math.min(500, Math.max(1, Math.floor(n)))
}

function githubAppSecretTestTargets(
  context: ApiContext,
  secretId: string,
): { apiBaseUrls: string[]; requiresGitHubApp: boolean } {
  const authRef = formatFactorySecretRef(secretId)
  const urls = new Set<string>()
  let linkedRepository = false
  const factory = context.repos.factory.get()
  const projects = factory == null ? [] : context.repos.projects.list(factory.id)
  for (const project of projects) {
    for (const repository of githubAppSecretRepositories(context, project.id)) {
      if (repository.spec.authRef?.trim() !== authRef) continue
      linkedRepository = true
      const remoteUrl = repository.spec.remoteUrl?.trim()
      if (remoteUrl == null || remoteUrl === '') continue
      const repo = parseGitHubRepoRef(remoteUrl)
      if (repo != null) urls.add(toGitHubApiBaseUrl(repo))
    }
  }
  return {
    apiBaseUrls: urls.size === 0 ? ['https://api.github.com'] : [...urls],
    requiresGitHubApp: linkedRepository,
  }
}

function githubAppSecretRepositories(context: ApiContext, projectId: ProjectId): Repository[] {
  return [
    ...context.repos.repositories.list(projectId),
    ...context.repos.targets.list(projectId).map(repositoryFromTarget),
  ]
}

function requireFactoryDir(context: ApiContext): string {
  if (context.factoryDataDir == null || context.factoryDataDir.trim() === '') {
    throw new Error('Factory data directory is required for local secret storage')
  }
  return context.factoryDataDir
}

function secretScope(context: ApiContext, body: Record<string, unknown>): { scope: FactorySecretScope; projectId: ProjectId | null } {
  const projectId = optionalString(body.projectId, 'projectId') ?? null
  const rawScope = optionalString(body.scope, 'scope')
  if (rawScope != null && rawScope !== 'factory' && rawScope !== 'project') {
    throw new ValidationError('scope must be factory or project')
  }
  const scope = (rawScope ?? (projectId == null ? 'factory' : 'project')) as FactorySecretScope
  if (scope === 'factory' && projectId != null) throw new ValidationError('projectId requires scope project')
  if (scope === 'project' && projectId == null) throw new ValidationError('projectId is required for project-scoped secrets')
  if (projectId != null && context.repos.projects.get(projectId as ProjectId) == null) {
    throw new NotFoundError(`Project not found: ${projectId}`)
  }
  return { scope, projectId: projectId as ProjectId | null }
}

function nullableString(value: unknown, field: string): string | null | undefined {
  if (value === null) return null
  return optionalString(value, field)
}

function metadata(record: FactorySecretStoredRecord): FactorySecretMetadata {
  return {
    id: record.id,
    name: record.name,
    scope: record.scope,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastRotatedAt: record.lastRotatedAt,
    lastTestedAt: record.lastTestedAt,
  }
}

function recordSecretAudit(
  context: ApiContext,
  eventType: string,
  record: Pick<FactorySecretStoredRecord, 'id' | 'name' | 'scope' | 'projectId' | 'status'>,
  title: string,
  status: string = record.status,
): void {
  recordAuditEvent(context, {
    eventType,
    status,
    title,
    projectId: record.projectId,
    summary: `${record.name} (${record.scope})`,
    metadata: {
      secretRef: formatFactorySecretRef(record.id),
      scope: record.scope,
      projectId: record.projectId,
    },
  })
}

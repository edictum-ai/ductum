import { createId, type ProjectId } from '../types.js'
import type { ConfigResource, ConfigResourceKind, ConfigResourceSpec } from '../resource-types.js'
import type { ConfigResourceRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface ConfigResourceRow {
  id: ConfigResource['id']
  kind: ConfigResourceKind
  project_id: string | null
  name: string
  spec: string
  created_at: string
  updated_at: string
}

function mapResource(row: ConfigResourceRow): ConfigResource {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id as ProjectId | null,
    name: row.name,
    spec: parseJson<ConfigResourceSpec>(row.spec),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

export class SqliteConfigResourceRepo implements ConfigResourceRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(filters: { kind?: ConfigResourceKind; projectId?: ProjectId | null } = {}): ConfigResource[] {
    const clauses: string[] = []
    const values: unknown[] = []
    if (filters.kind != null) {
      clauses.push('kind = ?')
      values.push(filters.kind)
    }
    if (filters.projectId !== undefined) {
      clauses.push(filters.projectId == null ? 'project_id IS NULL' : 'project_id = ?')
      if (filters.projectId != null) values.push(filters.projectId)
    }
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
    return this.db
      .prepare(`SELECT * FROM config_resources ${where} ORDER BY kind, name`)
      .all(...values)
      .map((row) => mapResource(row as ConfigResourceRow))
  }

  get(id: ConfigResource['id']): ConfigResource | null {
    const row = this.db.prepare('SELECT * FROM config_resources WHERE id = ?').get(id) as ConfigResourceRow | undefined
    return row == null ? null : mapResource(row)
  }

  getByName(kind: ConfigResourceKind, name: string, projectId: ProjectId | null = null): ConfigResource | null {
    const row = this.db
      .prepare('SELECT * FROM config_resources WHERE kind = ? AND name = ? AND project_id IS ?')
      .get(kind, name, projectId) as ConfigResourceRow | undefined
    return row == null ? null : mapResource(row)
  }

  create(resource: Omit<ConfigResource, 'createdAt' | 'updatedAt'>): ConfigResource {
    this.db
      .prepare('INSERT INTO config_resources (id, kind, project_id, name, spec) VALUES (?, ?, ?, ?, ?)')
      .run(resource.id, resource.kind, resource.projectId, resource.name, toJson(resource.spec))
    return this.getRequired(resource.id)
  }

  update(id: ConfigResource['id'], fields: Partial<Pick<ConfigResource, 'name' | 'projectId' | 'spec'>>): ConfigResource {
    const updates: string[] = []
    const values: unknown[] = []
    if (fields.name != null) {
      updates.push('name = ?')
      values.push(fields.name)
    }
    if (fields.projectId !== undefined) {
      updates.push('project_id = ?')
      values.push(fields.projectId)
    }
    if (fields.spec != null) {
      updates.push('spec = ?')
      values.push(toJson(fields.spec))
    }
    if (updates.length === 0) return this.getRequired(id)
    updates.push("updated_at = datetime('now')")
    const result = this.db.prepare(`UPDATE config_resources SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Config resource not found: ${id}`)
    return this.getRequired(id)
  }

  upsert(kind: ConfigResourceKind, name: string, spec: ConfigResourceSpec, projectId: ProjectId | null = null): ConfigResource {
    const existing = this.getByName(kind, name, projectId)
    return existing == null
      ? this.create({ id: createId<'ConfigResourceId'>(), kind, projectId, name, spec })
      : this.update(existing.id, { name, projectId, spec })
  }

  delete(id: ConfigResource['id']): void {
    this.db.prepare('DELETE FROM config_resources WHERE id = ?').run(id)
  }

  private getRequired(id: ConfigResource['id']): ConfigResource {
    return assertFound(this.get(id), `Config resource not found: ${id}`)
  }
}

import { createId, type ProjectId } from '../types.js'
import type { Target, TargetSpec } from '../resource-types.js'
import type { TargetRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface TargetRow {
  id: Target['id']
  project_id: string
  name: string
  spec: string
  created_at: string
  updated_at: string
}

function mapTarget(row: TargetRow): Target {
  return {
    id: row.id,
    projectId: row.project_id as ProjectId,
    name: row.name,
    spec: parseJson<TargetSpec>(row.spec),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

export class SqliteTargetRepo implements TargetRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(projectId: ProjectId): Target[] {
    return this.db
      .prepare('SELECT * FROM targets WHERE project_id = ? ORDER BY name')
      .all(projectId)
      .map((row) => mapTarget(row as TargetRow))
  }

  get(id: Target['id']): Target | null {
    const row = this.db.prepare('SELECT * FROM targets WHERE id = ?').get(id) as TargetRow | undefined
    return row == null ? null : mapTarget(row)
  }

  getByName(projectId: ProjectId, name: string): Target | null {
    const row = this.db
      .prepare('SELECT * FROM targets WHERE project_id = ? AND name = ?')
      .get(projectId, name) as TargetRow | undefined
    return row == null ? null : mapTarget(row)
  }

  create(target: Omit<Target, 'createdAt' | 'updatedAt'>): Target {
    this.db
      .prepare('INSERT INTO targets (id, project_id, name, spec) VALUES (?, ?, ?, ?)')
      .run(target.id, target.projectId, target.name, toJson(target.spec))
    return this.getRequired(target.id)
  }

  update(id: Target['id'], fields: Partial<Pick<Target, 'name' | 'spec'>>): Target {
    const updates: string[] = []
    const values: unknown[] = []

    if (fields.name != null) {
      updates.push('name = ?')
      values.push(fields.name)
    }
    if (fields.spec != null) {
      updates.push('spec = ?')
      values.push(toJson(fields.spec))
    }
    if (updates.length === 0) return this.getRequired(id)

    updates.push("updated_at = datetime('now')")
    const result = this.db.prepare(`UPDATE targets SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Target not found: ${id}`)
    return this.getRequired(id)
  }

  upsert(projectId: ProjectId, name: string, spec: TargetSpec): Target {
    const existing = this.getByName(projectId, name)
    return existing == null
      ? this.create({ id: createId<'TargetId'>(), projectId, name, spec })
      : this.update(existing.id, { name, spec })
  }

  delete(id: Target['id']): void {
    this.db.prepare('DELETE FROM targets WHERE id = ?').run(id)
  }

  private getRequired(id: Target['id']): Target {
    return assertFound(this.get(id), `Target not found: ${id}`)
  }
}

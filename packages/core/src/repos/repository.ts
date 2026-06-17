import { createId, type ProjectId } from '../types.js'
import type { Component, ComponentSpec, Repository, RepositoryId, RepositorySpec } from '../resource-types.js'
import { materializeRepository } from '../repository-model.js'
import type { ComponentRepo, RepositoryRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface RepositoryRow {
  id: RepositoryId
  project_id: string
  name: string
  spec: string
  created_at: string
  updated_at: string
}

interface ComponentRow {
  id: Component['id']
  repository_id: string
  name: string
  spec: string
  created_at: string
  updated_at: string
}

function mapRepository(row: RepositoryRow): Repository {
  return materializeRepository({
    id: row.id,
    projectId: row.project_id as ProjectId,
    name: row.name,
    spec: parseJson<RepositorySpec>(row.spec),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  })
}

function mapComponent(row: ComponentRow): Component {
  return {
    id: row.id,
    repositoryId: row.repository_id as RepositoryId,
    name: row.name,
    spec: parseJson<ComponentSpec>(row.spec),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

export class SqliteRepositoryRepo implements RepositoryRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(projectId: ProjectId): Repository[] {
    return this.db
      .prepare('SELECT * FROM repositories WHERE project_id = ? ORDER BY name')
      .all(projectId)
      .map((row) => mapRepository(row as RepositoryRow))
  }

  get(id: RepositoryId): Repository | null {
    const row = this.db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as RepositoryRow | undefined
    return row == null ? null : mapRepository(row)
  }

  getByName(projectId: ProjectId, name: string): Repository | null {
    const row = this.db
      .prepare('SELECT * FROM repositories WHERE project_id = ? AND name = ?')
      .get(projectId, name) as RepositoryRow | undefined
    return row == null ? null : mapRepository(row)
  }

  create(repository: Omit<Repository, 'identity' | 'portable' | 'readiness' | 'createdAt' | 'updatedAt'>): Repository {
    this.db
      .prepare('INSERT INTO repositories (id, project_id, name, spec) VALUES (?, ?, ?, ?)')
      .run(repository.id, repository.projectId, repository.name, toJson(repository.spec))
    return this.getRequired(repository.id)
  }

  update(id: RepositoryId, fields: Partial<Pick<Repository, 'name' | 'spec'>>): Repository {
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
    const result = this.db.prepare(`UPDATE repositories SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Repository not found: ${id}`)
    return this.getRequired(id)
  }

  upsert(projectId: ProjectId, name: string, spec: RepositorySpec): Repository {
    const existing = this.getByName(projectId, name)
    return existing == null
      ? this.create({ id: createId<'RepositoryId'>() as RepositoryId, projectId, name, spec })
      : this.update(existing.id, { name, spec })
  }

  delete(id: RepositoryId): void {
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id)
  }

  private getRequired(id: RepositoryId): Repository {
    return assertFound(this.get(id), `Repository not found: ${id}`)
  }
}

export class SqliteComponentRepo implements ComponentRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(repositoryId: RepositoryId): Component[] {
    return this.db
      .prepare('SELECT * FROM components WHERE repository_id = ? ORDER BY name')
      .all(repositoryId)
      .map((row) => mapComponent(row as ComponentRow))
  }

  get(id: Component['id']): Component | null {
    const row = this.db.prepare('SELECT * FROM components WHERE id = ?').get(id) as ComponentRow | undefined
    return row == null ? null : mapComponent(row)
  }

  getByName(repositoryId: RepositoryId, name: string): Component | null {
    const row = this.db
      .prepare('SELECT * FROM components WHERE repository_id = ? AND name = ?')
      .get(repositoryId, name) as ComponentRow | undefined
    return row == null ? null : mapComponent(row)
  }

  create(component: Omit<Component, 'createdAt' | 'updatedAt'>): Component {
    this.db
      .prepare('INSERT INTO components (id, repository_id, name, spec) VALUES (?, ?, ?, ?)')
      .run(component.id, component.repositoryId, component.name, toJson(component.spec))
    return this.getRequired(component.id)
  }

  update(id: Component['id'], fields: Partial<Pick<Component, 'name' | 'spec'>>): Component {
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
    const result = this.db.prepare(`UPDATE components SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Component not found: ${id}`)
    return this.getRequired(id)
  }

  upsert(repositoryId: RepositoryId, name: string, spec: ComponentSpec): Component {
    const existing = this.getByName(repositoryId, name)
    return existing == null
      ? this.create({ id: createId<'ComponentId'>() as Component['id'], repositoryId, name, spec })
      : this.update(existing.id, { name, spec })
  }

  delete(id: Component['id']): void {
    this.db.prepare('DELETE FROM components WHERE id = ?').run(id)
  }

  private getRequired(id: Component['id']): Component {
    return assertFound(this.get(id), `Component not found: ${id}`)
  }
}

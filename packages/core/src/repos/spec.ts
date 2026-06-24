import type { ProjectId, Spec, SpecDependency, SpecId, SpecStatus, SpecStrategy, SpecStrategyConfig } from '../types.js'
import { parseWorkItemSource, serializeWorkItemSource, type WorkItemSource } from '../work-item-source.js'
import type { SpecDependencyRepo, SpecRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  toIsoString,
  type SqliteDatabase,
} from './utils.js'

interface SpecRow {
  id: SpecId
  project_id: string
  name: string
  status: SpecStatus
  strategy: SpecStrategy
  strategy_config: string | null
  document: string
  source: string | null
  max_fix_iterations: number | null
  created_at: string
  updated_at: string
}

function mapSpec(row: SpecRow): Spec {
  const source = parseWorkItemSource(row.source)
  return {
    id: row.id,
    projectId: row.project_id as ProjectId,
    name: row.name,
    status: row.status,
    strategy: row.strategy ?? 'normal',
    strategyConfig: parseStrategyConfig(row.strategy_config),
    document: row.document,
    ...(source == null ? {} : { source }),
    maxFixIterations: row.max_fix_iterations,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

function mapDependency(row: { spec_id: string; depends_on_id: string; kind: 'hard' | 'soft' }): SpecDependency {
  return {
    specId: row.spec_id as SpecId,
    dependsOnId: row.depends_on_id as SpecId,
    kind: row.kind,
  }
}

export class SqliteSpecRepo implements SpecRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(projectId: ProjectId): Spec[] {
    return this.db
      .prepare('SELECT * FROM specs WHERE project_id = ? ORDER BY created_at, rowid')
      .all(projectId)
      .map((row) => mapSpec(row as SpecRow))
  }

  get(id: SpecId): Spec | null {
    const row = this.db.prepare('SELECT * FROM specs WHERE id = ?').get(id) as SpecRow | undefined
    return row == null ? null : mapSpec(row)
  }

  create(
    spec: Omit<Spec, 'createdAt' | 'updatedAt' | 'maxFixIterations' | 'strategy' | 'strategyConfig'> & {
      maxFixIterations?: number | null
      strategy?: SpecStrategy
      strategyConfig?: SpecStrategyConfig | null
      source?: WorkItemSource | null
    },
  ): Spec {
    this.db
      .prepare(
        'INSERT INTO specs (id, project_id, name, status, strategy, strategy_config, document, source, max_fix_iterations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        spec.id,
        spec.projectId,
        spec.name,
        spec.status,
        spec.strategy ?? 'normal',
        serializeStrategyConfig(spec.strategyConfig ?? null),
        spec.document,
        serializeWorkItemSource(spec.source ?? null),
        spec.maxFixIterations ?? null,
      )
    return this.getRequired(spec.id)
  }

  updateStatus(id: SpecId, status: SpecStatus): Spec {
    const result = this.db
      .prepare("UPDATE specs SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id)
    assertChanges(result.changes, `Spec not found: ${id}`)
    return this.getRequired(id)
  }

  delete(id: SpecId): void {
    this.db.prepare('DELETE FROM specs WHERE id = ?').run(id)
  }

  private getRequired(id: SpecId): Spec {
    return assertFound(this.get(id), `Spec not found: ${id}`)
  }
}

function serializeStrategyConfig(config: SpecStrategyConfig | null): string | null {
  return config == null ? null : JSON.stringify(config)
}

function parseStrategyConfig(value: string | null): SpecStrategyConfig | null {
  if (value == null || value.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!isStrategyConfig(parsed)) return null
  return parsed
}

function isStrategyConfig(value: unknown): value is SpecStrategyConfig {
  return value != null && typeof value === 'object' && (value as { kind?: unknown }).kind === 'best_of_n'
}

export class SqliteSpecDependencyRepo implements SpecDependencyRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(specId: SpecId): SpecDependency[] {
    return this.db
      .prepare('SELECT * FROM spec_dependencies WHERE spec_id = ? ORDER BY depends_on_id')
      .all(specId)
      .map((row) =>
        mapDependency(row as { spec_id: string; depends_on_id: string; kind: 'hard' | 'soft' }),
      )
  }

  add(dep: SpecDependency): void {
    this.db
      .prepare('INSERT INTO spec_dependencies (spec_id, depends_on_id, kind) VALUES (?, ?, ?)')
      .run(dep.specId, dep.dependsOnId, dep.kind)
  }

  remove(specId: SpecId, dependsOnId: SpecId): void {
    this.db.prepare('DELETE FROM spec_dependencies WHERE spec_id = ? AND depends_on_id = ?').run(specId, dependsOnId)
  }
}

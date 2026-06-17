import type { Factory, FactoryConfig, FactoryId } from '../types.js'
import type { FactoryRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface FactoryRow {
  id: FactoryId
  name: string
  config: string
  created_at: string
}

function mapFactory(row: FactoryRow): Factory {
  return {
    id: row.id,
    name: row.name,
    config: parseJson<FactoryConfig>(row.config),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteFactoryRepo implements FactoryRepo {
  constructor(private readonly db: SqliteDatabase) {}

  get(): Factory | null {
    const row = this.db.prepare('SELECT * FROM factories LIMIT 1').get() as FactoryRow | undefined
    return row == null ? null : mapFactory(row)
  }

  create(factory: Omit<Factory, 'createdAt'>): Factory {
    this.db
      .prepare('INSERT INTO factories (id, name, config) VALUES (?, ?, ?)')
      .run(factory.id, factory.name, toJson(factory.config))
    return this.getById(factory.id)
  }

  update(id: FactoryId, fields: Partial<Pick<Factory, 'name' | 'config'>>): Factory {
    const existing = this.getById(id)
    const result = this.db
      .prepare('UPDATE factories SET name = ?, config = ? WHERE id = ?')
      .run(fields.name ?? existing.name, toJson(fields.config ?? existing.config), id)
    assertChanges(result.changes, `Factory not found: ${id}`)
    return this.getById(id)
  }

  private getById(id: FactoryId): Factory {
    const row = this.db.prepare('SELECT * FROM factories WHERE id = ?').get(id) as FactoryRow | undefined
    return mapFactory(assertFound(row, `Factory not found: ${id}`))
  }
}

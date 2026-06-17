import type { Agent, AgentCapability, AgentEffort, AgentId, AgentResourceRefs, AgentSpawnConfig } from '../types.js'
import type { AgentRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface AgentRow {
  id: AgentId
  name: string
  model: string
  harness: Agent['harness']
  resource_refs: string
  capabilities: string
  effort: AgentEffort | null
  cost_tier: number
  spawn_config: string
  pricing: string | null
  created_at: string
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    harness: row.harness,
    resourceRefs: parseJson<AgentResourceRefs>(row.resource_refs ?? '{}'),
    capabilities: parseJson<AgentCapability[]>(row.capabilities),
    effort: row.effort,
    costTier: row.cost_tier ?? 50,
    spawnConfig: parseJson<AgentSpawnConfig>(row.spawn_config),
    pricing: row.pricing != null
      ? parseJson<{ inputUsdPer1M: number; outputUsdPer1M: number }>(row.pricing)
      : null,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
  }
}

export class SqliteAgentRepo implements AgentRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(): Agent[] {
    return this.db
      .prepare('SELECT * FROM agents ORDER BY created_at')
      .all()
      .map((row) => mapAgent(row as AgentRow))
  }

  get(id: AgentId): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow | undefined
    return row == null ? null : mapAgent(row)
  }

  getByName(name: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name) as AgentRow | undefined
    return row == null ? null : mapAgent(row)
  }

  create(agent: Omit<Agent, 'createdAt'>): Agent {
    this.db
      .prepare(
        'INSERT INTO agents (id, name, model, harness, resource_refs, capabilities, effort, cost_tier, spawn_config, pricing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        agent.id,
        agent.name,
        agent.model,
        agent.harness,
        toJson(agent.resourceRefs ?? {}),
        toJson(agent.capabilities),
        agent.effort ?? null,
        agent.costTier,
        toJson(agent.spawnConfig),
        agent.pricing != null ? toJson(agent.pricing) : null,
      )
    return this.getRequired(agent.id)
  }

  update(
    id: AgentId,
    fields: Partial<Pick<Agent, 'model' | 'harness' | 'resourceRefs' | 'capabilities' | 'effort' | 'costTier' | 'spawnConfig' | 'pricing'>>,
  ): Agent {
    const updates: string[] = []
    const values: unknown[] = []

    if (fields.model != null) {
      updates.push('model = ?')
      values.push(fields.model)
    }
    if (fields.harness != null) {
      updates.push('harness = ?')
      values.push(fields.harness)
    }
    if (fields.resourceRefs != null) {
      updates.push('resource_refs = ?')
      values.push(toJson(fields.resourceRefs))
    }
    if (fields.capabilities != null) {
      updates.push('capabilities = ?')
      values.push(toJson(fields.capabilities))
    }
    if (fields.effort !== undefined) {
      updates.push('effort = ?')
      values.push(fields.effort)
    }
    if (fields.costTier != null) {
      updates.push('cost_tier = ?')
      values.push(fields.costTier)
    }
    if (fields.spawnConfig != null) {
      updates.push('spawn_config = ?')
      values.push(toJson(fields.spawnConfig))
    }
    if (fields.pricing !== undefined) {
      updates.push('pricing = ?')
      values.push(fields.pricing != null ? toJson(fields.pricing) : null)
    }
    if (updates.length === 0) {
      return this.getRequired(id)
    }

    const result = this.db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values, id)
    assertChanges(result.changes, `Agent not found: ${id}`)
    return this.getRequired(id)
  }

  delete(id: AgentId): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  }

  private getRequired(id: AgentId): Agent {
    return assertFound(this.get(id), `Agent not found: ${id}`)
  }
}

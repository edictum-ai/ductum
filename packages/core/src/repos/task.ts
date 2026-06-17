import type {
  AgentId,
  AgentRole,
  ProjectId,
  TargetId,
  Task,
  TaskComplexity,
  TaskDependency,
  TaskId,
  TaskStatus,
  TaskStrategyRole,
} from '../types.js'
import type { TaskDependencyRepo, TaskRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface TaskRow {
  id: TaskId
  spec_id: string
  target_id: string | null
  repository_id: string | null
  component_id: string | null
  name: string
  prompt: string
  repos: string
  assigned_agent_id: string | null
  required_role: AgentRole | null
  complexity: TaskComplexity | null
  status: TaskStatus
  strategy_role: TaskStrategyRole
  strategy_group: string | null
  verification: string
  retry_count: number
  retry_after: string | null
  budget_extra_usd: number | null
  turn_extra_count: number | null
  created_at: string
  updated_at: string
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    specId: row.spec_id as Task['specId'],
    targetId: row.target_id as TargetId | null,
    repositoryId: row.repository_id,
    componentId: row.component_id,
    name: row.name,
    prompt: row.prompt,
    repos: parseJson<string[]>(row.repos),
    assignedAgentId: row.assigned_agent_id as AgentId | null,
    requiredRole: row.required_role,
    complexity: row.complexity ?? null,
    status: row.status,
    strategyRole: row.strategy_role ?? 'normal',
    strategyGroup: row.strategy_group,
    verification: parseJson<string[]>(row.verification),
    retryCount: row.retry_count,
    retryAfter: toIsoString(row.retry_after),
    budgetExtraUsd: row.budget_extra_usd ?? 0,
    turnExtraCount: row.turn_extra_count ?? 0,
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

function mapDependency(row: { task_id: string; depends_on_id: string }): TaskDependency {
  return {
    taskId: row.task_id as TaskId,
    dependsOnId: row.depends_on_id as TaskId,
  }
}

export class SqliteTaskRepo implements TaskRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(specId: Task['specId']): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks WHERE spec_id = ? ORDER BY created_at, rowid')
      .all(specId)
      .map((row) => mapTask(row as TaskRow))
  }

  listBySpecIds(specIds: readonly Task['specId'][]): Task[] {
    if (specIds.length === 0) return []
    const placeholders = specIds.map(() => '?').join(', ')
    return this.db
      .prepare(`SELECT * FROM tasks WHERE spec_id IN (${placeholders}) ORDER BY created_at, rowid`)
      .all(...specIds)
      .map((row) => mapTask(row as TaskRow))
  }

  get(id: TaskId): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    return row == null ? null : mapTask(row)
  }

  getReady(projectId?: ProjectId, role?: AgentRole): Task[] {
    return this.db
      .prepare(
        `
          SELECT t.*
          FROM tasks t
          JOIN specs s ON s.id = t.spec_id
          WHERE t.status = 'ready'
            AND s.status IN ('approved', 'implementing')
            AND (@projectId IS NULL OR s.project_id = @projectId)
            AND (
              @role IS NULL
              OR (t.assigned_agent_id IS NULL AND COALESCE(t.required_role, 'builder') = @role)
              OR EXISTS (
                SELECT 1
                FROM project_agents pa
                WHERE pa.project_id = s.project_id
                  AND pa.agent_id = t.assigned_agent_id
                  AND pa.role = @role
              )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM task_dependencies td
              JOIN tasks dep ON dep.id = td.depends_on_id
              WHERE td.task_id = t.id
                AND (
                  (t.strategy_role = 'blind_review' AND dep.status NOT IN ('done', 'failed'))
                  OR (t.strategy_role != 'blind_review' AND dep.status != 'done')
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM runs r
              WHERE r.task_id = t.id
                AND r.stage != 'done'
                AND r.terminal_state IS NULL
            )
          ORDER BY s.created_at, s.rowid, t.created_at, t.rowid
        `,
      )
      .all({ projectId: projectId ?? null, role: role ?? null })
      .map((row) => mapTask(row as TaskRow))
  }

  create(
    task: Omit<
      Task,
      | 'createdAt'
      | 'updatedAt'
      | 'targetId'
      | 'repositoryId'
      | 'componentId'
      | 'requiredRole'
      | 'complexity'
      | 'strategyRole'
      | 'strategyGroup'
      | 'retryCount'
      | 'retryAfter'
      | 'budgetExtraUsd'
      | 'turnExtraCount'
    > & {
      targetId?: Task['targetId']
      repositoryId?: Task['repositoryId']
      componentId?: Task['componentId']
      requiredRole?: Task['requiredRole']
      complexity?: Task['complexity']
      strategyRole?: TaskStrategyRole
      strategyGroup?: string | null
      retryCount?: number
      retryAfter?: string | null
      budgetExtraUsd?: number
      turnExtraCount?: number
    },
  ): Task {
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, spec_id, target_id, repository_id, component_id, name, prompt,
          repos, assigned_agent_id, required_role, complexity, status,
          strategy_role, strategy_group, verification, retry_count, retry_after,
          budget_extra_usd, turn_extra_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.specId,
        task.targetId ?? null,
        task.repositoryId ?? null,
        task.componentId ?? null,
        task.name,
        task.prompt,
        toJson(task.repos),
        task.assignedAgentId,
        task.requiredRole ?? null,
        task.complexity ?? null,
        task.status,
        task.strategyRole ?? 'normal',
        task.strategyGroup ?? null,
        toJson(task.verification),
        task.retryCount ?? 0,
        task.retryAfter?.replace('T', ' ').replace('Z', '') ?? null,
        task.budgetExtraUsd ?? 0,
        task.turnExtraCount ?? 0,
      )
    return this.getRequired(task.id)
  }

  updateStatus(id: TaskId, status: TaskStatus): Task {
    const result = this.db
      .prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(status, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  updatePrompt(id: TaskId, prompt: string): Task {
    const result = this.db
      .prepare("UPDATE tasks SET prompt = ?, updated_at = datetime('now') WHERE id = ?")
      .run(prompt, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  updateRetry(id: TaskId, retryCount: number, retryAfter: string | null): Task {
    const normalizedAfter = retryAfter?.replace('T', ' ').replace('Z', '') ?? null
    const result = this.db
      .prepare("UPDATE tasks SET retry_count = ?, retry_after = ?, updated_at = datetime('now') WHERE id = ?")
      .run(retryCount, normalizedAfter, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  assignAgent(id: TaskId, agentId: AgentId): Task {
    const result = this.db
      .prepare("UPDATE tasks SET assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(agentId, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  incrementBudgetExtra(id: TaskId, byUsd: number): Task {
    if (!Number.isFinite(byUsd) || byUsd < 0) {
      throw new Error(`incrementBudgetExtra: byUsd must be a non-negative finite number, got ${byUsd}`)
    }
    const result = this.db
      .prepare(
        "UPDATE tasks SET budget_extra_usd = COALESCE(budget_extra_usd, 0) + ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(byUsd, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  incrementTurnExtra(id: TaskId, byCount: number): Task {
    if (!Number.isInteger(byCount) || byCount < 0) {
      throw new Error(`incrementTurnExtra: byCount must be a non-negative integer, got ${byCount}`)
    }
    const result = this.db
      .prepare(
        "UPDATE tasks SET turn_extra_count = COALESCE(turn_extra_count, 0) + ?, updated_at = datetime('now') WHERE id = ?",
      )
      .run(byCount, id)
    assertChanges(result.changes, `Task not found: ${id}`)
    return this.getRequired(id)
  }

  delete(id: TaskId): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  private getRequired(id: TaskId): Task {
    return assertFound(this.get(id), `Task not found: ${id}`)
  }
}

export class SqliteTaskDependencyRepo implements TaskDependencyRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(taskId: TaskId): TaskDependency[] {
    return this.db
      .prepare('SELECT * FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_id')
      .all(taskId)
      .map((row) => mapDependency(row as { task_id: string; depends_on_id: string }))
  }

  add(dep: TaskDependency): void {
    this.db
      .prepare('INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)')
      .run(dep.taskId, dep.dependsOnId)
  }

  remove(taskId: TaskId, dependsOnId: TaskId): void {
    this.db.prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?').run(taskId, dependsOnId)
  }
}

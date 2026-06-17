import type { AgentId, AgentRole, Project, ProjectAgent, ProjectConfig, ProjectId } from '../types.js'
import type { ProjectAgentRepo, ProjectRepo } from './interfaces.js'
import {
  assertChanges,
  assertFound,
  parseJson,
  toIsoString,
  toJson,
  type SqliteDatabase,
} from './utils.js'

interface ProjectRow {
  id: ProjectId
  factory_id: string
  name: string
  repos: string
  config: string
  created_at: string
  updated_at: string
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    factoryId: row.factory_id as Project['factoryId'],
    name: row.name,
    repos: parseJson<string[]>(row.repos),
    config: parseJson<ProjectConfig>(row.config),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

function mapAssignment(row: { project_id: string; agent_id: string; role: AgentRole }): ProjectAgent {
  return {
    projectId: row.project_id as ProjectId,
    agentId: row.agent_id as AgentId,
    role: row.role,
  }
}

export class SqliteProjectRepo implements ProjectRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(factoryId: Project['factoryId']): Project[] {
    return this.db
      .prepare('SELECT * FROM projects WHERE factory_id = ? ORDER BY created_at')
      .all(factoryId)
      .map((row) => mapProject(row as ProjectRow))
  }

  get(id: ProjectId): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
    return row == null ? null : mapProject(row)
  }

  getByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as ProjectRow | undefined
    return row == null ? null : mapProject(row)
  }

  create(project: Omit<Project, 'createdAt' | 'updatedAt'>): Project {
    this.db
      .prepare('INSERT INTO projects (id, factory_id, name, repos, config) VALUES (?, ?, ?, ?, ?)')
      .run(project.id, project.factoryId, project.name, toJson(project.repos), toJson(project.config))
    return this.getRequired(project.id)
  }

  update(id: ProjectId, fields: Partial<Pick<Project, 'name' | 'repos' | 'config'>>): Project {
    const updates: string[] = []
    const values: unknown[] = []

    if (fields.name != null) {
      updates.push('name = ?')
      values.push(fields.name)
    }
    if (fields.repos != null) {
      updates.push('repos = ?')
      values.push(toJson(fields.repos))
    }
    if (fields.config != null) {
      updates.push('config = ?')
      values.push(toJson(fields.config))
    }
    if (updates.length === 0) {
      return this.getRequired(id)
    }

    updates.push("updated_at = datetime('now')")
    const result = this.db
      .prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`)
      .run(...values, id)
    assertChanges(result.changes, `Project not found: ${id}`)
    return this.getRequired(id)
  }

  delete(id: ProjectId): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  private getRequired(id: ProjectId): Project {
    return assertFound(this.get(id), `Project not found: ${id}`)
  }
}

export class SqliteProjectAgentRepo implements ProjectAgentRepo {
  constructor(private readonly db: SqliteDatabase) {}

  list(projectId: ProjectId): ProjectAgent[] {
    return this.db
      .prepare('SELECT * FROM project_agents WHERE project_id = ? ORDER BY agent_id')
      .all(projectId)
      .map((row) => mapAssignment(row as { project_id: string; agent_id: string; role: AgentRole }))
  }

  assign(assignment: ProjectAgent): void {
    this.db
      .prepare(
        'INSERT INTO project_agents (project_id, agent_id, role) VALUES (?, ?, ?) ' +
          'ON CONFLICT(project_id, agent_id, role) DO NOTHING',
      )
      .run(assignment.projectId, assignment.agentId, assignment.role)
  }

  unassign(projectId: ProjectId, agentId: AgentId, role?: AgentRole): void {
    if (role != null) {
      this.db.prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ? AND role = ?')
        .run(projectId, agentId, role)
    } else {
      this.db.prepare('DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?')
        .run(projectId, agentId)
    }
  }

  getByRole(projectId: ProjectId, role: AgentRole): ProjectAgent[] {
    return this.db
      .prepare('SELECT * FROM project_agents WHERE project_id = ? AND role = ? ORDER BY agent_id')
      .all(projectId, role)
      .map((row) => mapAssignment(row as { project_id: string; agent_id: string; role: AgentRole }))
  }
}

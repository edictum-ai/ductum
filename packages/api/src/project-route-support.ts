import type { Run } from '@ductum/core'

import type { ApiContext } from './lib/deps.js'
import { ValidationError } from './lib/errors.js'
import { getRunExecutionIntegrityFieldsMap, type ExecutionIntegrityFields } from './lib/execution-integrity.js'
import { normalizeRepositoryInput } from './lib/repositories.js'
import { buildRunUiContract, type RunUiContract } from './lib/ui-contract.js'

interface ProjectRunRow {
  id: string
  task_name: string
  spec_name: string
  agent_name: string
  agent_model: string
  retry_count: number
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`)
  return value
}

export function projectRepositoriesFromBody(body: Record<string, unknown>) {
  const repositories = body.repositories
  if (repositories != null) {
    if (!Array.isArray(repositories)) throw new ValidationError('repositories must be an array')
    return repositories.map((entry, index) => normalizeRepositoryInput(entry, `repositories[${index}]`))
  }
  if (body.repository != null) return [normalizeRepositoryInput(body.repository, 'repository')]
  return []
}

export interface ProjectRun extends ExecutionIntegrityFields {
  id: string
  taskId: string
  taskName: string
  specName: string
  agentId: string
  agentName: string
  agentModel: string
  retryCount: number
  stage: string
  terminalState: string | null
  pendingApproval: boolean
  failReason: string | null
  costUsd: number
  tokensIn: number
  tokensOut: number
  lastHeartbeat: string | null
  createdAt: string
  updatedAt: string
  ui: RunUiContract
}

export function listProjectRuns(context: ApiContext, projectId: string): ProjectRun[] {
  const project = context.repos.projects.get(projectId as never)
  if (project == null) return []
  const rows = context.db.prepare(`
    SELECT
      r.id, r.task_id, COALESCE(t.name, r.task_id) AS task_name, COALESCE(s.name, 'Unknown spec') AS spec_name,
      r.agent_id, COALESCE(a.name, r.agent_id) AS agent_name, COALESCE(a.model, '') AS agent_model,
      COALESCE(t.retry_count, 0) AS retry_count, r.stage, r.terminal_state, r.pending_approval, r.fail_reason,
      r.cost_usd, r.tokens_in, r.tokens_out, r.last_heartbeat, r.created_at, r.updated_at
    FROM runs r
    LEFT JOIN tasks t ON t.id = r.task_id
    LEFT JOIN specs s ON s.id = t.spec_id
    LEFT JOIN agents a ON a.id = r.agent_id
    WHERE s.project_id = ?
    ORDER BY r.created_at DESC
  `).all(projectId) as Array<ProjectRunRow & {
    task_id: string
    agent_id: string
    stage: string
    terminal_state: string | null
    pending_approval: number
    fail_reason: string | null
    cost_usd: number
    tokens_in: number
    tokens_out: number
    last_heartbeat: string | null
    created_at: string
    updated_at: string
  }>
  const runsById = new Map(
    context.repos.runs.listByTaskIds([...new Set(rows.map((row) => row.task_id as Run['taskId']))]).map((run) => [run.id, run] as const),
  )
  const integrityByRunId = getRunExecutionIntegrityFieldsMap(context, [...runsById.values()])
  return rows.map((row) => {
    const run = runsById.get(row.id as never)!
    return {
      ...integrityByRunId.get(run.id)!,
      id: row.id,
      taskId: row.task_id,
      taskName: row.task_name,
      specName: row.spec_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      agentModel: row.agent_model,
      retryCount: row.retry_count,
      stage: row.stage,
      terminalState: row.terminal_state,
      pendingApproval: row.pending_approval === 1,
      failReason: row.fail_reason,
      costUsd: row.cost_usd,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      lastHeartbeat: row.last_heartbeat ? row.last_heartbeat.replace(' ', 'T') + 'Z' : null,
      createdAt: row.created_at.replace(' ', 'T') + 'Z',
      updatedAt: row.updated_at.replace(' ', 'T') + 'Z',
      ui: buildRunUiContract(run, {
        projectName: project.name,
        specName: row.spec_name,
        taskName: row.task_name,
      }),
    }
  })
}

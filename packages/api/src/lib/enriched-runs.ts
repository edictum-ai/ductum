import { isActionableApprovalRun, type Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { getRunExecutionIntegrityFieldsMap, type ExecutionIntegrityFields } from './execution-integrity.js'
import { openWorkflowFollowupForRun } from './run-workflow-followup.js'
import { buildRunUiContract, type RunUiContract } from './ui-contract.js'

export interface EnrichedRun extends Run, ExecutionIntegrityFields {
  taskName: string
  specName: string
  projectName: string
  agentName: string
  agentModel: string
  retryCount: number
  ui: RunUiContract
}

interface EnrichedRunRow {
  id: string
  task_name: string
  spec_name: string
  project_name: string
  agent_name: string
  agent_model: string
  retry_count: number
}

export function listEnrichedRuns(
  context: ApiContext,
  filters?: { stage?: string; limit?: number },
): EnrichedRun[] {
  const listedRuns = context.repos.runs.listAll(filters)
  const lineageRuns =
    filters?.stage === 'ship' ? context.repos.runs.listAll({ limit: 10_000 }) : listedRuns
  const runs =
    filters?.stage === 'ship'
      ? listedRuns.filter((run) => isActionableApprovalRun(run, lineageRuns))
      : listedRuns
  if (runs.length === 0) {
    return []
  }

  const placeholders = runs.map(() => '?').join(', ')
  const rows = context.db
    .prepare(
      `
        SELECT
          r.id,
          COALESCE(t.name, r.task_id) AS task_name,
          COALESCE(s.name, 'Unknown spec') AS spec_name,
          COALESCE(p.name, 'Unknown project') AS project_name,
          COALESCE(a.name, r.agent_id) AS agent_name,
          COALESCE(a.model, '') AS agent_model,
          COALESCE(t.retry_count, 0) AS retry_count
        FROM runs r
        LEFT JOIN tasks t ON t.id = r.task_id
        LEFT JOIN specs s ON s.id = t.spec_id
        LEFT JOIN projects p ON p.id = s.project_id
        LEFT JOIN agents a ON a.id = r.agent_id
        WHERE r.id IN (${placeholders})
      `,
    )
    .all(...runs.map((run) => run.id)) as EnrichedRunRow[]

  const detailsByRunId = new Map(rows.map((row) => [row.id, row]))
  const integrityByRunId = getRunExecutionIntegrityFieldsMap(context, runs)

  return runs.map((run) => {
    const details = detailsByRunId.get(run.id)
    return {
      ...run,
      ...integrityByRunId.get(run.id)!,
      taskName: details?.task_name ?? run.taskId,
      specName: details?.spec_name ?? 'Unknown spec',
      projectName: details?.project_name ?? 'Unknown project',
      agentName: details?.agent_name ?? run.agentId,
      agentModel: details?.agent_model ?? '',
      retryCount: details?.retry_count ?? 0,
      ui: buildRunUiContract(run, {
        projectName: details?.project_name ?? 'Unknown project',
        specName: details?.spec_name ?? 'Unknown spec',
        taskName: details?.task_name ?? run.taskId,
        workflowFollowup: openWorkflowFollowupForRun(context.repos.tasks, run),
      }),
    }
  })
}

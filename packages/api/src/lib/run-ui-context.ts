import type { Run } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { openWorkflowFollowupForRun } from './run-workflow-followup.js'
import { buildRunUiContract, type RunUiContract } from './ui-contract.js'

export type RunWithUi<T extends Run = Run> = T & { ui: RunUiContract }

interface RunContextRow {
  run_id: string
  project_name: string
  spec_name: string
  task_name: string
}

export function decorateRunWithUi(context: ApiContext, run: Run): RunWithUi {
  return decorateRunsWithUi(context, [run])[0]!
}

export function decorateNullableRunWithUi(context: ApiContext, run: Run | null | undefined): RunWithUi | null {
  if (run == null) return null
  return decorateRunWithUi(context, run)
}

export function decorateRunsWithUi(context: ApiContext, runs: Run[]): RunWithUi[] {
  if (runs.length === 0) return []
  const contexts = getRunUiContexts(context, runs)
  return runs.map((run) => {
    const row = contexts.get(run.id)
    return {
      ...run,
      ui: buildRunUiContract(run, row == null ? undefined : {
        ...row,
        workflowFollowup: openWorkflowFollowupForRun(context.repos.tasks, run),
      }),
    }
  })
}

function getRunUiContexts(
  context: ApiContext,
  runs: Run[],
): Map<Run['id'], { projectName: string; specName: string; taskName: string }> {
  const placeholders = runs.map(() => '?').join(', ')
  const rows = context.db
    .prepare(
      `
        SELECT
          r.id AS run_id,
          COALESCE(p.name, 'Unknown project') AS project_name,
          COALESCE(s.name, 'Unknown spec') AS spec_name,
          COALESCE(t.name, r.task_id) AS task_name
        FROM runs r
        LEFT JOIN tasks t ON t.id = r.task_id
        LEFT JOIN specs s ON s.id = t.spec_id
        LEFT JOIN projects p ON p.id = s.project_id
        WHERE r.id IN (${placeholders})
      `,
    )
    .all(...runs.map((run) => run.id)) as RunContextRow[]

  return new Map(
    rows.map((row) => [
      row.run_id as Run['id'],
      {
        projectName: row.project_name,
        specName: row.spec_name,
        taskName: row.task_name,
      },
    ]),
  )
}

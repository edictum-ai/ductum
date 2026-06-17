/**
 * Spec lifecycle operations that need to reach across multiple
 * repos — mainly the cascading delete used by DELETE /api/specs/:id.
 *
 * SQLite's schema uses ON DELETE CASCADE on specs → tasks, but runs
 * only have a plain `REFERENCES tasks(id)` (no cascade) because the
 * original factory design never intended to let operators drop a
 * spec mid-run. That means deleting a spec that has any runs raises
 * a FK violation.
 *
 * `deleteSpecCascading` walks the child tables in FK-safe order:
 *
 *   1. Collect every task in the spec and every run under those
 *      tasks.
 *   2. Kill any live harness sessions tied to those runs so the
 *      dispatcher isn't holding a dead DB row.
 *   3. Delete all run child rows (activity, updates, stage history,
 *      evidence, gate evaluations, session mappings, decisions).
 *   4. Delete runs.
 *   5. Let the spec cascade handle tasks + task_dependencies +
 *      spec_dependencies.
 *
 * Everything runs inside a single SQLite transaction so a partial
 * failure doesn't leave the DB in an inconsistent state. If a run
 * is mid-dispatch the best-effort kill swallows any error; the
 * transactional delete still removes the row either way.
 */

import type { RunId, SpecId, TaskId } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { NotFoundError } from './errors.js'

export interface DeleteSpecResult {
  specId: SpecId
  tasksDeleted: number
  runsDeleted: number
  runsKilled: number
}

export async function deleteSpecCascading(
  context: ApiContext,
  specId: string,
): Promise<DeleteSpecResult> {
  const spec = context.repos.specs.get(specId as SpecId)
  if (spec == null) throw new NotFoundError(`Spec not found: ${specId}`)

  // 1. Collect everything we need to touch before the delete.
  const tasks = context.repos.tasks.list(spec.id)
  const runIds: RunId[] = []
  for (const task of tasks) {
    for (const run of context.repos.runs.list(task.id)) {
      runIds.push(run.id)
    }
  }

  // 2. Kill any live harness sessions so the dispatcher doesn't
  //    operate on rows that are about to disappear. Best-effort —
  //    a run that isn't currently running resolves to a no-op.
  let runsKilled = 0
  if (context.killRun != null) {
    for (const runId of runIds) {
      try {
        await context.killRun(runId)
        runsKilled += 1
      } catch {
        // swallow — delete is authoritative even if kill fails.
      }
    }
  }

  // 3. Dispose any per-run Edictum runtimes so we don't leak memory
  //    pointing at rows we're about to remove.
  for (const runId of runIds) {
    try {
      context.enforcement.disposeRuntime(runId)
    } catch {
      // ignore
    }
  }

  // 4. Transactional delete — child rows first, then runs, then the
  //    spec (which cascades tasks + dependencies). better-sqlite3
  //    exposes `transaction` on the db handle; any throw inside the
  //    function rolls back automatically.
  const runIdsJson = runIds
  const db = context.db
  const txn = db.transaction((runIdList: RunId[]) => {
    if (runIdList.length > 0) {
      // Delete run child rows in FK-safe order. Using placeholders
      // for ~hundreds of ids is fine for SQLite — the typical spec
      // has <100 runs. Chunk if this ever changes.
      const placeholders = runIdList.map(() => '?').join(',')
      db.prepare(`DELETE FROM run_activity WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM run_updates WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM run_stage_history WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM evidence WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM gate_evaluations WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM session_run_mapping WHERE run_id IN (${placeholders})`).run(...runIdList)
      // decisions.run_id is ON DELETE SET NULL, so the FK handles it
      // automatically when we delete runs — no manual touch needed.
      // parent_run_id on runs is also plain REFERENCES with no
      // cascade, so we clear it explicitly before the run delete to
      // avoid FK violations when siblings reference each other.
      db.prepare(`UPDATE runs SET parent_run_id = NULL WHERE parent_run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...runIdList)
    }
    // Deleting the spec cascades to tasks, task_dependencies, and
    // spec_dependencies via ON DELETE CASCADE.
    db.prepare('DELETE FROM specs WHERE id = ?').run(specId)
  })

  txn(runIdsJson)

  return {
    specId: spec.id,
    tasksDeleted: tasks.length,
    runsDeleted: runIds.length,
    runsKilled,
  }
}

/**
 * Convenience: delete a single task and all its runs (+ child rows)
 * in the same FK-safe manner. Used by the task delete route so an
 * operator can drop one task without nuking the entire spec.
 */
export function deleteTaskCascading(
  context: ApiContext,
  taskId: string,
): { taskId: TaskId; runsDeleted: number } {
  const task = context.repos.tasks.get(taskId as TaskId)
  if (task == null) throw new NotFoundError(`Task not found: ${taskId}`)
  const runIds = context.repos.runs.list(task.id).map((r) => r.id)
  const db = context.db
  const txn = db.transaction((runIdList: RunId[]) => {
    if (runIdList.length > 0) {
      const placeholders = runIdList.map(() => '?').join(',')
      db.prepare(`DELETE FROM run_activity WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM run_updates WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM run_stage_history WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM evidence WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM gate_evaluations WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM session_run_mapping WHERE run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`UPDATE runs SET parent_run_id = NULL WHERE parent_run_id IN (${placeholders})`).run(...runIdList)
      db.prepare(`DELETE FROM runs WHERE id IN (${placeholders})`).run(...runIdList)
    }
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
  })
  txn(runIds)
  return { taskId: task.id, runsDeleted: runIds.length }
}

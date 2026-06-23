import { classifyTask, type Run, type Task } from '@ductum/core'

import type { ApiContext } from './deps.js'
import { recordTaskStatusReconcileAudit } from './reconcile-audit.js'
import type { TaskReconcileEntry } from './reconcile-types.js'

export function repairClosedLineageTask(
  context: ApiContext,
  task: Task,
  runs: Run[],
  dryRun: boolean,
): TaskReconcileEntry | null {
  const parsed = classifyTask(task)
  if (parsed.kind !== 'fix' && parsed.kind !== 'review') return null
  if (runs.some((run) => run.terminalState == null && run.stage !== 'done')) return null

  if (runs.length === 0) {
    const reason = 'active lineage task has no attempt'
    if (!dryRun) context.repos.tasks.updateStatus(task.id, 'ready')
    return {
      taskId: task.id,
      taskName: task.name,
      fromStatus: task.status,
      toStatus: 'ready',
      reason,
    }
  }

  const latestDone = [...runs].reverse().find((run) => run.stage === 'done')
  if (latestDone == null) return null
  const reason = 'lineage task attempt completed'
  const audit = dryRun ? undefined : context.db.transaction(() => {
    context.repos.tasks.updateStatus(task.id, 'done')
    return recordTaskStatusReconcileAudit(context, {
      task,
      anchorRun: latestDone,
      reason: 'task_done',
      status: 'done',
      fromStatus: task.status,
      message: reason,
      runIds: runs.map((run) => run.id),
    })
  })()
  return {
    taskId: task.id,
    taskName: task.name,
    fromStatus: task.status,
    toStatus: 'done',
    reason,
    auditRunId: latestDone.id,
    ...(audit == null ? {} : { audit }),
  }
}

export function repairStaleFailedLineageTask(
  context: ApiContext,
  task: Task,
  specTasks: Task[],
  dryRun: boolean,
): TaskReconcileEntry | null {
  if (task.status !== 'failed') return null
  const parsed = classifyTask(task)
  if (parsed.kind !== 'fix' && parsed.kind !== 'review') return null
  const ownRuns = context.repos.runs.list(task.id)
  if (ownRuns.some(isLiveRun)) return null

  const ownDone = latestDoneRun(ownRuns)
  const followupDone = ownDone ?? latestCompletedFollowup(context, specTasks, task, parsed)
  if (followupDone == null) return null

  const reason = 'lineage completed after failed retry'
  const audit = dryRun ? undefined : context.db.transaction(() => {
    context.repos.tasks.updateStatus(task.id, 'done')
    return recordTaskStatusReconcileAudit(context, {
      task,
      anchorRun: followupDone,
      reason: 'task_done',
      status: 'done',
      fromStatus: task.status,
      message: reason,
      runIds: [followupDone.id],
    })
  })()

  return {
    taskId: task.id,
    taskName: task.name,
    fromStatus: task.status,
    toStatus: 'done',
    reason,
    auditRunId: followupDone.id,
    ...(audit == null ? {} : { audit }),
  }
}

function latestCompletedFollowup(
  context: ApiContext,
  specTasks: Task[],
  task: Task,
  parsed: ReturnType<typeof classifyTask>,
): Run | null {
  let latest: Run | null = null
  const taskKey = lineageKey(task.name, parsed.originalName)
  const taskIndex = specTasks.findIndex((candidate) => candidate.id === task.id)
  for (const candidate of specTasks) {
    if (candidate.id === task.id || candidate.status !== 'done') continue
    if (taskIndex >= 0 && specTasks.indexOf(candidate) <= taskIndex) continue
    const candidateParsed = classifyTask(candidate)
    if (candidateParsed.kind === 'impl') continue
    const candidateKey = lineageKey(candidate.name, candidateParsed.originalName)
    if (candidateKey.root !== taskKey.root) continue
    if (compareRounds(candidateKey.rounds, taskKey.rounds) < 0) continue
    latest = latestDoneRun(context.repos.runs.list(candidate.id)) ?? latest
  }
  return latest
}

function lineageKey(taskName: string, parsedOriginalName: string): { root: string; rounds: number[] } {
  const rounds: number[] = []
  let current = taskName
  for (let i = 0; i < 8; i += 1) {
    const reviewRound = current.match(/^review-(.+)-r(\d+)$/)
    if (reviewRound != null) {
      rounds.unshift(Number(reviewRound[2]))
      current = reviewRound[1]!
      continue
    }
    if (current.startsWith('review-')) {
      rounds.unshift(1)
      current = current.slice('review-'.length)
      continue
    }
    const fixRound = current.match(/^fix-(.+)-r(\d+)$/)
    if (fixRound != null) {
      rounds.unshift(Number(fixRound[2]))
      current = fixRound[1]!
      continue
    }
    if (current.startsWith('fix-')) {
      current = current.slice('fix-'.length)
      continue
    }
    break
  }
  return { root: current === taskName ? parsedOriginalName : current, rounds }
}

function compareRounds(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

function latestDoneRun(runs: Run[]): Run | null {
  return [...runs].reverse().find((run) => run.stage === 'done' && run.terminalState == null) ?? null
}

function isLiveRun(run: Run): boolean {
  return run.terminalState == null && run.stage !== 'done'
}

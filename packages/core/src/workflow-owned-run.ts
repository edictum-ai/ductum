import type { TaskRepo } from './repos/interfaces.js'
import { classifyTask } from './task-lineage.js'
import type { Run } from './types.js'

type WorkflowOwnedRun = Pick<Run, 'stage' | 'pendingApproval' | 'taskId' | 'blockedReason' | 'branch' | 'commitSha'>

export function isWorkflowOwnedRun(run: WorkflowOwnedRun, taskRepo: Pick<TaskRepo, 'get' | 'list'>): boolean {
  return isApprovalWaitingShipRun(run) || isCompletionBlockedShipRun(run) || hasDownstreamLineageWork(run, taskRepo)
}

export function isApprovalWaitingShipRun(run: Pick<Run, 'stage' | 'pendingApproval'>): boolean {
  return run.stage === 'ship' && run.pendingApproval
}

export function isCompletionBlockedShipRun(
  run: Pick<Run, 'stage' | 'blockedReason' | 'branch' | 'commitSha'>,
): boolean {
  return run.stage === 'ship'
    && nonBlank(run.blockedReason)
    && nonBlank(run.branch)
    && nonBlank(run.commitSha)
}

function hasDownstreamLineageWork(run: Pick<Run, 'taskId'>, taskRepo: Pick<TaskRepo, 'get' | 'list'>): boolean {
  const task = taskRepo.get(run.taskId)
  if (task == null) return false
  const parsed = classifyTask(task)
  const originalName = parsed.kind === 'impl' ? task.name : parsed.originalName

  return taskRepo.list(task.specId).some((candidate) => {
    if (candidate.id === task.id || candidate.status === 'done') return false
    const candidateParsed = classifyTask(candidate)
    return candidateParsed.kind !== 'impl' && candidateParsed.originalName === originalName
  })
}

function nonBlank(value: string | null): boolean {
  return value != null && value.trim() !== ''
}

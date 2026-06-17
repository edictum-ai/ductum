import { classifyTask, type Run, type Task, type TaskRepo } from '@ductum/core'

type FollowupKind = 'review' | 'fix'

export function openWorkflowFollowupForRun(
  taskRepo: Pick<TaskRepo, 'get' | 'list'>,
  run: Pick<Run, 'taskId'>,
): FollowupKind | null {
  const task = taskRepo.get(run.taskId)
  if (task == null) return null
  const parsed = classifyTask(task)
  if (parsed.kind === 'review') return null
  const originalName = parsed.kind === 'impl' ? task.name : parsed.originalName

  const followups: Array<{ kind: FollowupKind; task: Task }> = []
  for (const candidate of taskRepo.list(task.specId)) {
    const kind = openFollowupKind(candidate, task, originalName)
    if (kind != null) followups.push({ kind, task: candidate })
  }
  return (
    findFollowupKind(followups, 'review', true)
    ?? findFollowupKind(followups, 'fix', true)
    ?? findFollowupKind(followups, 'review', false)
    ?? findFollowupKind(followups, 'fix', false)
    ?? null
  )
}

function openFollowupKind(candidate: Task, task: Task, originalName: string): FollowupKind | null {
  if (candidate.id === task.id || candidate.status === 'done' || candidate.status === 'failed') return null
  const parsed = classifyTask(candidate)
  if (parsed.originalName !== originalName) return null
  if (parsed.kind === 'review') return 'review'
  if (parsed.kind === 'fix') return 'fix'
  return null
}

function findFollowupKind(
  followups: Array<{ kind: FollowupKind; task: Task }>,
  kind: FollowupKind,
  actionableOnly: boolean,
): FollowupKind | null {
  const match = followups.find((followup) =>
    followup.kind === kind
    && (!actionableOnly || followup.task.status === 'ready' || followup.task.status === 'active'),
  )
  return match == null ? null : kind
}

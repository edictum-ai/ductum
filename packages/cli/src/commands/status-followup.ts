import { classifyTask, type ParsedTaskName, type Run } from '@ductum/core'

import type { TaskRecord } from './status-data.js'

export function selectOpenWorkflowFollowup(
  records: TaskRecord[],
  run: Pick<Run, 'taskId'>,
): TaskRecord | null {
  const taskRecord = records.find((record) => record.task.id === run.taskId)
  if (taskRecord == null) return null
  const parsed = classifyTask(taskRecord.task)
  if (parsed.kind === 'review') return null
  const originalName = parsed.kind === 'impl' ? taskRecord.task.name : parsed.originalName

  const followups = records.filter((record) => {
    if (record.task.id === taskRecord.task.id || record.task.status === 'done' || record.task.status === 'failed') {
      return false
    }
    const candidate = classifyTask(record.task)
    if (candidate.kind === 'impl' || candidate.originalName !== originalName) return false
    // For a current fix/review task, do not let an older or same-round
    // same-lineage follow-up shadow the in-flight newer round. Open
    // follow-ups in later rounds remain visible so the operator still sees
    // the active tail of the lineage. Implementation tasks keep surfacing
    // any open fix/review in the lineage.
    if (isLineageRound(parsed) && candidate.round <= parsed.round) return false
    return true
  })
  return (
    findFollowupRecord(followups, 'review', true)
    ?? findFollowupRecord(followups, 'fix', true)
    ?? findFollowupRecord(followups, 'review', false)
    ?? findFollowupRecord(followups, 'fix', false)
    ?? null
  )
}

function isLineageRound(parsed: ParsedTaskName): boolean {
  return parsed.kind === 'fix' || parsed.kind === 'review'
}

function findFollowupRecord(
  records: TaskRecord[],
  kind: 'review' | 'fix',
  actionableOnly: boolean,
): TaskRecord | null {
  return records.find((record) => {
    const parsed = classifyTask(record.task)
    return parsed.kind === kind
      && (!actionableOnly || record.task.status === 'ready' || record.task.status === 'active')
  }) ?? null
}

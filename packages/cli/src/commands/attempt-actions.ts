import {
  buildStaleApprovalDenyReason,
  isStaleApprovalRun,
  parseStaleApprovalFailureReason,
  quoteCliArg,
  type Run,
} from '@ductum/core'
export { quoteCliArg } from '@ductum/core'

import type { TaskRecord } from './status-data.js'

export function buildApproveCommand(runId: string) {
  return `approve ${runId}`
}

export function buildApprovalNextCommand(
  run: Pick<Run, 'id' | 'branch' | 'failReason' | 'stage' | 'terminalState' | 'pendingApproval'>,
) {
  if (!isStaleApprovalRun(run)) {
    return buildApproveCommand(run.id)
  }
  const details = parseStaleApprovalFailureReason(run.failReason)
  return buildDenyCommand(run.id, buildStaleApprovalDenyReason({
    branch: details?.branch ?? run.branch ?? undefined,
    base: details?.base,
  }))
}

export function buildStatusCommand(runId: string) {
  return `status ${runId}`
}

export function buildWatchCommand(runId: string) {
  return `watch ${runId}`
}

export function buildLogsCommand(runId: string) {
  return `logs ${runId}`
}

export function buildRetryCommand(runId: string) {
  return `retry ${runId}`
}

export function buildDenyCommand(runId: string, reason: string) {
  return `deny ${runId} --reason ${quoteCliArg(reason)}`
}

export function buildAttemptStartCommand(record: TaskRecord) {
  const agent = record.agent?.name == null ? '<agent>' : quoteCliArg(record.agent.name)
  return [
    `attempt start ${quoteCliArg(record.task.id)}`,
    `--agent ${agent}`,
    `--project ${quoteCliArg(record.project.name)}`,
  ].join(' ')
}

export function withDuctum(command: string) {
  return `ductum ${command}`
}

import { isStaleApprovalRun } from '@ductum/core'

import type { WorkspaceSnapshot } from '../types.js'
import {
  buildApprovalNextCommand,
  buildAttemptStartCommand,
  buildDenyCommand,
  buildRetryCommand,
  buildStatusCommand,
  buildWatchCommand,
  quoteCliArg,
  withDuctum,
} from './attempt-actions.js'
import {
  listActiveRuns,
  listNeedsOperatorRuns,
  listReadyTasks,
  listStalledRuns,
  listWaitingApprovalRuns,
} from './status-data.js'

export interface OperatorNextAction {
  state: string
  reason: string
  commands: string[]
  alternateCommands?: string[]
}

export function buildSharedNextAction(input: {
  snapshot: WorkspaceSnapshot
  now: Date
  factoryPresent?: boolean
  integrityPresent?: boolean
  integrityIssues?: number
}): OperatorNextAction {
  const snapshot = input.snapshot
  const now = input.now
  const approvalsWaiting = listWaitingApprovalRuns(snapshot, now)
  const activeRuns = listActiveRuns(snapshot, now)
  const readyTasks = listReadyTasks(snapshot)
  const needsOperator = listNeedsOperatorRuns(snapshot, now)
  const stalledRuns = listStalledRuns(snapshot, now)
  const firstProject = snapshot.projects[0]
  const firstApproval = approvalsWaiting[0]
  const firstOperatorRun = needsOperator[0]
  const firstReadyTask = readyTasks[0]
  const firstActiveRun = activeRuns[0]

  if (input.factoryPresent === false) return action('initialize_factory', 'The API has no factory record yet.', ['init'])
  if (input.integrityPresent === false) return action('upgrade_api', 'The API did not return execution integrity data.', ['repair'])
  if ((input.integrityIssues ?? 0) > 0) {
    return action('repair_integrity', `${input.integrityIssues} execution integrity issue(s) need review.`, ['repair'])
  }
  if (firstProject == null) {
    return action('create_project', 'No Project is registered in this Factory.', ['project create <name> --repo "$PWD" --merge-mode human'])
  }
  if (!snapshot.repositories.some((repository) => repository.projectId === firstProject.id)) {
    return action('add_repository', 'The first Project has no Repository.', [`repository add ${quoteCliArg(firstProject.name)} --repo "$PWD"`])
  }
  if (snapshot.agents.length === 0) {
    return action('repair_agent_setup', 'Factory Settings has no enabled Agent ready for work.', ['repair'])
  }
  if (snapshot.projectAgents.length === 0) {
    return action('repair_project_assignment', 'No Agent is assigned to a Project role.', ['repair'])
  }
  if (firstOperatorRun != null) {
    return action('repair_attempt', 'A failed or stalled Attempt needs operator action.', [
      buildRetryCommand(firstOperatorRun.run.id),
    ])
  }
  if (firstApproval != null) {
    const stale = isStaleApprovalRun(firstApproval.run)
    return action(stale ? 'resolve_stale_approval' : 'resolve_approval', stale
      ? 'A reviewed branch fell behind the base branch and must be denied before retry.'
      : 'An Attempt is waiting for operator approval.', [
      buildApprovalNextCommand(firstApproval.run),
    ], stale ? undefined : [buildDenyCommand(firstApproval.run.id, 'Needs a smaller patch')])
  }
  if (firstReadyTask != null) {
    return action('start_attempt', 'A ready Task can start an Attempt through Ductum.', [buildAttemptStartCommand(firstReadyTask)])
  }
  if (firstActiveRun != null) {
    return action('watch_attempt', 'An Attempt is active.', [
      buildWatchCommand(firstActiveRun.run.id),
      buildStatusCommand(firstActiveRun.run.id),
    ])
  }
  if (stalledRuns.length > 0) {
    const noun = stalledRuns.length === 1 ? 'Attempt' : 'Attempts'
    const verb = stalledRuns.length === 1 ? 'remains' : 'remain'
    return action('intake_spec', `${stalledRuns.length} past stalled ${noun} ${verb} in history; no current repair item is waiting.`, [
      `spec intake ${quoteCliArg(firstProject.name)} <spec-or-directory> --import`,
    ])
  }
  return action('intake_spec', 'The Factory is idle and ready for real work.', [
    `spec intake ${quoteCliArg(firstProject.name)} <spec-or-directory> --import`,
  ])
}

export function action(state: string, reason: string, commands: string[], alternateCommands?: string[]): OperatorNextAction {
  return { state, reason, commands: commands.map(withDuctum), alternateCommands: alternateCommands?.map(withDuctum) }
}

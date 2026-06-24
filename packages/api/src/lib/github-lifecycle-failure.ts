import type { RunId, RunStateMachine, RunUpdateRepo } from '@ductum/core'

export interface GitHubLifecycleFailureContext {
  stateMachine: Pick<RunStateMachine, 'markFailed'>
  runUpdates: Pick<RunUpdateRepo, 'create'>
}

export function failGitHubLifecycleBeforeApproval(
  context: GitHubLifecycleFailureContext,
  runId: RunId,
  message: string,
) {
  context.runUpdates.create(runId, message)
  return context.stateMachine.markFailed(runId, message)
}

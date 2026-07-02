import type { Run } from '@ductum/core'

import { ValidationError } from '../errors.js'
import { nonBlank } from './common.js'

/**
 * Issue #243: minimal live PR view used by the merge path. `headSha` and
 * `headBranch` are populated whenever the GitHub App API path fetches the
 * PR — the merge driver compares them to the recorded attempt state before
 * calling `/pulls/:n/merge`. Without this explicit check the only signal
 * that the PR head moved is GitHub's 409 merge response, which is too
 * generic to surface to an operator.
 */
export interface PullRequestLiveState {
  prNumber: number | null
  headSha?: string | null
  headBranch?: string | null
}

export function describePullRequestState(state: PullRequestLiveState): string {
  const prLabel = state.prNumber == null ? 'PR' : `PR #${state.prNumber}`
  return `${prLabel} head=${state.headSha ?? '?'} branch=${state.headBranch ?? '?'}`
}

/**
 * Issue #243: fail closed unless the live PR view matches the recorded
 * attempt state. PR creation alone is not completion — even if the operator
 * approves, the runtime must refuse to merge when the PR head SHA or head
 * branch does not match what the attempt pinned. Defence in depth on top
 * of `guardStalePrHeadApproval` (approve entry) and `expectedHeadSha`
 * (GitHub merge API 409).
 *
 * Missing live-state fields skip the corresponding check (the merge path
 * may not have them for dev fixtures); present-but-mismatched fields fail.
 */
export function assertPullRequestStateMatchesRun(
  run: Pick<Run, 'id' | 'branch' | 'commitSha'>,
  state: PullRequestLiveState,
): void {
  if (nonBlank(run.branch) && nonBlank(state.headBranch) && run.branch !== state.headBranch) {
    throw new ValidationError(
      `PR-backed merge rejected for run ${run.id}: PR head branch "${state.headBranch}" does not match recorded branch "${run.branch}" (${describePullRequestState(state)})`,
    )
  }
  if (nonBlank(run.commitSha) && nonBlank(state.headSha) && run.commitSha !== state.headSha) {
    throw new ValidationError(
      `PR-backed merge rejected for run ${run.id}: PR head SHA ${state.headSha} does not match recorded commitSha ${run.commitSha} (${describePullRequestState(state)})`,
    )
  }
}

import { describe, expect, it } from 'vitest'

import { assertPullRequestStateMatchesRun, describePullRequestState } from '../../../lib/run-ops/merge-pr-state.js'

describe('merge-pr-state assertPullRequestStateMatchesRun', () => {
  it('passes when the recorded branch and commitSha match the live PR view', () => {
    expect(() => assertPullRequestStateMatchesRun(
      { id: 'run-1' as never, branch: 'feature/x', commitSha: 'abc123' },
      { prNumber: 42, headBranch: 'feature/x', headSha: 'abc123' },
    )).not.toThrow()
  })

  it('fails closed when the live PR head branch differs from the recorded branch', () => {
    expect(() => assertPullRequestStateMatchesRun(
      { id: 'run-1' as never, branch: 'feature/x', commitSha: 'abc123' },
      { prNumber: 42, headBranch: 'feature/y', headSha: 'abc123' },
    )).toThrow(/PR head branch "feature\/y" does not match recorded branch "feature\/x"/)
  })

  it('fails closed when the live PR head SHA differs from the recorded commitSha', () => {
    expect(() => assertPullRequestStateMatchesRun(
      { id: 'run-1' as never, branch: 'feature/x', commitSha: 'abc123' },
      { prNumber: 42, headBranch: 'feature/x', headSha: 'def456' },
    )).toThrow(/PR head SHA def456 does not match recorded commitSha abc123/)
  })

  it('skips the branch check when the live view omits headBranch', () => {
    expect(() => assertPullRequestStateMatchesRun(
      { id: 'run-1' as never, branch: 'feature/x', commitSha: 'abc123' },
      { prNumber: 42, headSha: 'abc123' },
    )).not.toThrow()
  })

  it('skips the head SHA check when the live view omits headSha', () => {
    expect(() => assertPullRequestStateMatchesRun(
      { id: 'run-1' as never, branch: 'feature/x', commitSha: 'abc123' },
      { prNumber: 42, headBranch: 'feature/x' },
    )).not.toThrow()
  })

  it('describes the PR state with branch and head sha for operator-visible failures', () => {
    expect(describePullRequestState({ prNumber: 42, headBranch: 'feature/x', headSha: 'abc123' }))
      .toBe('PR #42 head=abc123 branch=feature/x')
    expect(describePullRequestState({ prNumber: null, headBranch: null, headSha: null }))
      .toBe('PR head=? branch=?')
  })
})

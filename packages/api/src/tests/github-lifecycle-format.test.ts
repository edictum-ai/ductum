import type { Evidence, GitHubIssueSource, Run, Spec, Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'
import { buildGitHubIssueCompletionComment } from '../lib/github-lifecycle-format.js'

const source: GitHubIssueSource = {
  kind: 'github-issue',
  provider: 'github',
  repoOwner: 'edictum-ai',
  repoName: 'ductum',
  issueNumber: 132,
  issueUrl: 'https://github.com/edictum-ai/ductum/issues/132',
  title: 'docs: prove GitHub issue comment-back',
  labels: ['documentation'],
  importedAt: '2026-06-26T04:42:00.000Z',
  formId: 'ductum-work-item',
  parsed: {
    workType: 'Documentation',
    priority: 'P2 - useful for production readiness',
    area: 'auth',
    blockers: [],
    objective: 'Prove comment-back.',
    evidence: ['#12'],
    requirements: ['Comment back on the issue'],
    outOfScope: ['Do not add secrets'],
    acceptanceCriteria: ['Issue comment exists'],
    verificationCommands: ['git diff --check'],
    safetyNotes: ['Docs only'],
    suggestedBranch: 'docs/github-issue-commentback-proof',
  },
}

describe('GitHub lifecycle formatting', () => {
  it('summarizes worktree snapshot verification evidence in issue comments', () => {
    const comment = buildGitHubIssueCompletionComment({
      spec: { id: 'spec', projectId: 'project', name: source.title, status: 'approved', document: '# spec', source } as Spec,
      task: { id: 'task', specId: 'spec', name: source.title, prompt: 'docs', repos: ['docs'], source, verification: ['git diff --check'] } as Task,
      run: { id: 'run-1' } as Run,
      branch: 'docs/github-issue-commentback-proof',
      commitSha: 'abc123',
      prNumber: 133,
      prUrl: 'https://github.com/edictum-ai/ductum/pull/133',
      verificationEvidence: {
        id: 'evidence',
        runId: 'run-1',
        type: 'custom',
        payload: {
          kind: 'worktree.snapshot',
          verifyOutput: { command: 'git diff --check', exitCode: 0, tail: '' },
        },
        createdAt: '2026-06-26T04:42:00.000Z',
      } as unknown as Evidence,
    })

    expect(comment).toContain('- Verification: git diff --check (passed)')
  })
})

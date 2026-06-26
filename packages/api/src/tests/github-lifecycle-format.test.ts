import type { Evidence, GitHubIssueSource, Run, Spec, Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'
import { buildGitHubIssueCompletionComment } from '../lib/github-lifecycle-format.js'
import { buildRuntimeVerificationEvidencePayload } from '../lib/runtime-approval-evidence.js'

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

const spec = { id: 'spec', projectId: 'project', name: source.title, status: 'approved', document: '# spec', source } as Spec
const run = { id: 'run-1' } as Run

function buildComment(task: Task, evidence: Evidence[]) {
  return buildGitHubIssueCompletionComment({
    spec,
    task,
    run,
    branch: 'docs/github-issue-commentback-proof',
    commitSha: 'abc123',
    prNumber: 133,
    prUrl: 'https://github.com/edictum-ai/ductum/pull/133',
    evidence,
  })
}

describe('GitHub lifecycle formatting', () => {
  it('summarizes worktree snapshot verification evidence in issue comments', () => {
    const comment = buildComment(
      { id: 'task', specId: 'spec', name: source.title, prompt: 'docs', repos: ['docs'], source, verification: ['git diff --check'] } as Task,
      [{
        id: 'evidence',
        runId: 'run-1',
        type: 'custom',
        payload: {
          kind: 'worktree.snapshot',
          verifyOutput: { command: 'git diff --check', exitCode: 0, tail: '' },
        },
        createdAt: '2026-06-26T04:42:00.000Z',
      } as unknown as Evidence],
    )

    expect(comment).toContain('- Verification: git diff --check (passed)')
  })

  it('renders structured verification evidence and CI without missing-evidence fallbacks', () => {
    const task = {
      id: 'task',
      specId: 'spec',
      name: source.title,
      prompt: 'docs',
      repos: ['docs'],
      source,
      verification: [
        'git diff --check',
        'pnpm --filter @ductum/cli test -- src/tests/factory-secret-command.test.ts src/tests/repository-command.test.ts',
      ],
    } as Task
    const comment = buildComment(task, [
      {
        id: 'structured-test',
        runId: 'run-1',
        type: 'test',
        payload: {
          results: [
            { command: 'git diff --check', status: 'passed' },
            {
              command: 'pnpm --filter @ductum/cli test -- src/tests/factory-secret-command.test.ts src/tests/repository-command.test.ts',
              status: 'blocked',
              summary: 'worktree module resolution blocked targeted CLI Vitest',
            },
          ],
        },
        createdAt: '2026-06-26T04:42:00.000Z',
      } as unknown as Evidence,
      {
        id: 'ci-pass',
        runId: 'run-1',
        type: 'ci',
        payload: {
          passed: true,
          commitSha: 'aee6640200c1a99add319795119ccbd32c6e0689',
          checks: [
            { name: 'audit', status: 'completed', conclusion: 'success' },
            { name: 'bootstrap-self-test', status: 'completed', conclusion: 'success' },
            { name: 'build-and-test', status: 'completed', conclusion: 'success' },
          ],
        },
        createdAt: '2026-06-26T04:50:00.000Z',
      } as unknown as Evidence,
    ])

    expect(comment).toContain('- Verification: git diff --check (passed)')
    expect(comment).toContain('- Verification: pnpm --filter @ductum/cli test -- src/tests/factory-secret-command.test.ts src/tests/repository-command.test.ts (blocked: worktree module resolution blocked targeted CLI Vitest)')
    expect(comment).toContain('- CI: commit `aee6640200c1a99add319795119ccbd32c6e0689` (passed: audit, bootstrap-self-test, build-and-test)')
    expect(comment).not.toContain('missing evidence')
  })

  it('matches imported task verification commands against runtime command evidence', () => {
    const task = {
      id: 'task',
      specId: 'spec',
      name: source.title,
      prompt: 'docs',
      repos: ['docs'],
      source,
      verification: [
        'git diff --check',
        'pnpm build',
      ],
    } as Task
    const comment = buildComment(task, [{
      id: 'verify',
      runId: 'run-1',
      type: 'custom',
      payload: buildRuntimeVerificationEvidencePayload(
        { commitSha: 'abc123' } as Run,
        {
          passed: true,
          output: '$ git diff --check\n\n$ pnpm build',
          commands: [
            { command: 'git diff --check', passed: true, output: '$ git diff --check' },
            { command: 'pnpm build', passed: true, output: '$ pnpm build' },
          ],
        },
      ),
      createdAt: '2026-06-26T04:42:00.000Z',
    } as unknown as Evidence])

    expect(comment).toContain('- Verification: git diff --check (passed)')
    expect(comment).toContain('- Verification: pnpm build (passed)')
    expect(comment).not.toContain('no matching evidence recorded')
  })
})

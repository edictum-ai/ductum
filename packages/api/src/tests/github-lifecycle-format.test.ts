import type { Evidence, GitHubIssueSource, Run, Spec, Task } from '@ductum/core'
import { describe, expect, it } from 'vitest'
import { buildConventionalPrTitle, buildGitHubIssueCompletionComment } from '../lib/github-lifecycle-format.js'
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
  it('sanitizes imported planning prefixes out of generated PR titles', () => {
    const prefixedSource = {
      ...source,
      title: '[post-P9 P4] Document one shared secret validator for every config write path',
    } satisfies GitHubIssueSource
    const prefixedSpec = { ...spec, source: prefixedSource } as Spec
    const task = {
      id: 'task',
      specId: 'spec',
      name: prefixedSource.title,
      prompt: 'docs',
      repos: ['docs'],
      source: prefixedSource,
      verification: ['git diff --check'],
    } as Task

    const title = buildConventionalPrTitle(prefixedSpec, task)

    expect(title).toBe('feat: Document one shared secret validator for every config write path')
    expect(title).not.toMatch(/\[post-P\d+\s+P\d+\]|(?:^| )P\d+(?:$| )|p-[a-z0-9-]+/i)
  })

  it('sanitizes standalone P-stage prefixes out of generated PR titles', () => {
    const prefixedSource = {
      ...source,
      title: 'P2: Prove GitHub issue comment-back',
    } satisfies GitHubIssueSource
    const prefixedSpec = { ...spec, source: prefixedSource } as Spec
    const task = {
      id: 'task',
      specId: 'spec',
      name: prefixedSource.title,
      prompt: 'docs',
      repos: ['docs'],
      source: prefixedSource,
      verification: ['git diff --check'],
    } as Task

    expect(buildConventionalPrTitle(prefixedSpec, task)).toBe('feat: Prove GitHub issue comment-back')
  })

  it('strips leading stage and process labels (S0, S1, S1a, S6, HOTFIX) from generated PR titles', () => {
    const cases: Array<[string, string]> = [
      ['S0: Define factory baseline', 'feat: Define factory baseline'],
      ['S1: Build core pipeline', 'feat: Build core pipeline'],
      ['S1a: Refine core pipeline', 'feat: Refine core pipeline'],
      ['S6: Ship to operators', 'feat: Ship to operators'],
      ['HOTFIX: Recover dropped PR reference', 'feat: Recover dropped PR reference'],
    ]
    for (const [input, expected] of cases) {
      const labelledSource = { ...source, title: input } satisfies GitHubIssueSource
      const labelledSpec = { ...spec, source: labelledSource } as Spec
      const task = {
        id: 'task',
        specId: 'spec',
        name: input,
        prompt: 'feat',
        repos: ['core'],
        source: labelledSource,
        verification: ['git diff --check'],
      } as Task
      const title = buildConventionalPrTitle(labelledSpec, task)
      expect(title).toBe(expected)
      expect(title).not.toMatch(/\bS\d+[a-z]?\b|\bHOTFIX\b/i)
    }
  })

  it('converts uppercase task slugs into readable PR titles', () => {
    const slugSource = {
      ...source,
      title: 'P4-RECOVER-PR-REFERENCE-CLAMP-CLEAN-COMMIT',
    } satisfies GitHubIssueSource
    const slugSpec = { ...spec, source: slugSource } as Spec
    const task = {
      id: 'task',
      specId: 'spec',
      name: slugSource.title,
      prompt: 'feat',
      repos: ['core'],
      source: slugSource,
      verification: [] as string[],
    } as Task

    const title = buildConventionalPrTitle(slugSpec, task)
    expect(title).toBe('feat: recover PR reference clamp clean commit')
    expect(title).not.toMatch(/[A-Z]{4,}|(?:^| )P\d+(?:$| )|[Pp]-[a-z0-9-]+/)
  })

  it('preserves short acronyms such as API while lowercasing longer uppercase words', () => {
    const mixedSource = {
      ...source,
      title: 'P5-API-GATEWAY-CONFIGURATION',
    } satisfies GitHubIssueSource
    const mixedSpec = { ...spec, source: mixedSource } as Spec
    const task = {
      id: 'task',
      specId: 'spec',
      name: mixedSource.title,
      prompt: 'feat',
      repos: ['core'],
      source: mixedSource,
      verification: [] as string[],
    } as Task

    expect(buildConventionalPrTitle(mixedSpec, task)).toBe('feat: API gateway configuration')
  })

  it('falls back to a generic placeholder when sanitization strips all content', () => {
    // sanitizeGeneratedGitTitle('P3') === 'task' — when the entire issue
    // title is a planning/process token, the sanitizer folds to a generic
    // placeholder so the PR-title path never emits an empty 'feat: ' body
    // and never carries a raw P* planning label either.
    const planningOnlySource = {
      ...source,
      title: 'P3',
    } satisfies GitHubIssueSource
    const planningOnlySpec = { ...spec, source: planningOnlySource } as Spec
    const task = {
      id: 'task',
      specId: 'spec',
      name: 'P3',
      prompt: 'feat',
      repos: ['core'],
      source: planningOnlySource,
      verification: [] as string[],
    } as Task

    const title = buildConventionalPrTitle(planningOnlySpec, task)

    expect(title).toBe('feat: task')
    expect(title).not.toBe('feat: ')
    expect(title).not.toMatch(/P\d+/)
    expect(title).toMatch(/^[a-z]+: .+$/)
  })

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

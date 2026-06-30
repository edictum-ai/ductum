import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ProjectRun, Spec, Task } from '@/api/client'
import { SpecSection } from '@/components/project/ProjectSpecSection'

const now = '2026-06-15T12:00:00.000Z'

function spec(overrides: Partial<Spec> = {}): Spec {
  return {
    id: 'spec1',
    projectId: 'project1',
    name: 'memory-foundation',
    status: 'done',
    document: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function task(name: string, requiredRole: string | null = null): Task {
  return {
    id: `task-${name}`,
    specId: 'spec1',
    name,
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole,
    complexity: null,
    status: 'done',
    verification: [],
    createdAt: now,
    updatedAt: now,
  }
}

function run(taskName: string, overrides: Partial<ProjectRun> = {}): ProjectRun {
  return {
    id: `run-${taskName}`,
    taskId: `task-${taskName}`,
    taskName,
    specName: 'memory-foundation',
    agentId: 'agent1',
    agentName: 'Codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    stage: 'done',
    terminalState: null,
    pendingApproval: false,
    failReason: null,
    costUsd: 0,
    tokensIn: 0,
    tokensOut: 0,
    lastHeartbeat: null,
    createdAt: now,
    updatedAt: now,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  }
}

describe('Project SpecSection', () => {
  it('shows a human brief from GitHub issue metadata instead of raw redacted text', () => {
    render(
      <SpecSection
        spec={spec({
          document: 'token: [redacted]',
          source: {
            kind: 'github-issue',
            provider: 'github',
            repoOwner: 'edictum-ai',
            repoName: 'ductum',
            issueNumber: 62,
            issueUrl: 'https://github.com/edictum-ai/ductum/issues/62',
            title: 'Fix GitHub App auth',
            labels: ['auth'],
            importedAt: now,
            formId: 'ductum-work-item',
            parsed: {
              workType: 'fix',
              priority: 'P1',
              area: 'auth',
              blockers: [],
              objective: 'Validate repository GitHub App credentials before native issue intake starts.',
              evidence: [],
              requirements: ['Show the operator exactly which GitHub App credential is missing.'],
              outOfScope: [],
              acceptanceCriteria: ['Native issue intake fails closed when installation auth is incomplete.'],
              verificationCommands: ['pnpm --filter @ductum/api test -- github'],
              safetyNotes: [],
            },
          },
        })}
        tasks={[task('P1-GITHUB-APP-AUTH')]}
        specRuns={[]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="ductum"
      />,
    )

    expect(screen.getByText('Validate repository GitHub App credentials before native issue intake starts.')).toBeInTheDocument()
    expect(screen.getByText(/For Maintainers and reviewers for edictum-ai\/ductum/)).toBeInTheDocument()
    expect(screen.getByText('edictum-ai/ductum#62')).toBeInTheDocument()
    expect(screen.getByText('Show the operator exactly which GitHub App credential is missing.')).toBeInTheDocument()
    expect(screen.queryByText('token: [redacted]')).not.toBeInTheDocument()
  })

  it('keeps authored work visible and collapses review-loop tasks and attempts', () => {
    render(
      <SpecSection
        spec={spec()}
        tasks={[task('P1-SPEC-HYGIENE'), task('review-P1-SPEC-HYGIENE', 'reviewer'), task('fix-P1-SPEC-HYGIENE-r1', 'builder')]}
        specRuns={[run('P1-SPEC-HYGIENE'), run('review-P1-SPEC-HYGIENE'), run('fix-P1-SPEC-HYGIENE-r1')]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="qratum"
      />,
    )

    expect(screen.getAllByText('P1-SPEC-HYGIENE').length).toBeGreaterThan(0)
    expect(screen.getByText('1/1 authored done')).toBeInTheDocument()
    expect(screen.queryByText('review-P1-SPEC-HYGIENE')).not.toBeInTheDocument()
    expect(screen.queryByText('fix-P1-SPEC-HYGIENE-r1')).not.toBeInTheDocument()
    expect(screen.queryByText('Review loop history')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show review loop'))

    expect(screen.getByText('Hide review loop')).toBeInTheDocument()
    expect(screen.getAllByText('review-P1-SPEC-HYGIENE').length).toBeGreaterThan(0)
    expect(screen.getAllByText('fix-P1-SPEC-HYGIENE-r1').length).toBeGreaterThan(0)
    expect(screen.getByText('Review loop history')).toBeInTheDocument()
  })

  it('does not hide authored tasks that only look like review names', () => {
    render(
      <SpecSection
        spec={spec()}
        tasks={[task('review-release-notes'), task('fix-copy-r1')]}
        specRuns={[run('review-release-notes'), run('fix-copy-r1')]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="qratum"
      />,
    )

    expect(screen.getAllByText('review-release-notes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('fix-copy-r1').length).toBeGreaterThan(0)
    expect(screen.queryByText('Show review loop')).not.toBeInTheDocument()
  })

  it('does not duplicate review-loop rows when a spec has no authored task metadata', () => {
    render(
      <SpecSection
        spec={spec()}
        tasks={[task('review-P1-SPEC-HYGIENE', 'reviewer'), task('fix-P1-SPEC-HYGIENE-r1', 'builder')]}
        specRuns={[run('review-P1-SPEC-HYGIENE'), run('fix-P1-SPEC-HYGIENE-r1')]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="qratum"
      />,
    )

    expect(screen.queryByText('Show review loop')).not.toBeInTheDocument()
    expect(screen.getAllByText('review-P1-SPEC-HYGIENE')).toHaveLength(2)
    expect(screen.getAllByText('fix-P1-SPEC-HYGIENE-r1')).toHaveLength(2)
    expect(screen.queryByText('Review loop history')).not.toBeInTheDocument()
  })

  it('does not show review runs in the authored recent list when only authored task metadata exists', () => {
    render(
      <SpecSection
        spec={spec()}
        tasks={[task('P1-SPEC-HYGIENE'), task('review-P1-SPEC-HYGIENE', 'reviewer')]}
        specRuns={[run('review-P1-SPEC-HYGIENE')]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="qratum"
      />,
    )

    expect(screen.getByText('P1-SPEC-HYGIENE')).toBeInTheDocument()
    expect(screen.queryByText('review-P1-SPEC-HYGIENE')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show review loop'))

    expect(screen.getAllByText('review-P1-SPEC-HYGIENE').length).toBeGreaterThan(0)
  })

  it('marks collapsed review loops when they need attention', () => {
    render(
      <SpecSection
        spec={spec()}
        tasks={[task('P1-SPEC-HYGIENE'), task('review-P1-SPEC-HYGIENE', 'reviewer')]}
        specRuns={[
          run('P1-SPEC-HYGIENE'),
          run('review-P1-SPEC-HYGIENE', { terminalState: 'failed', failReason: 'review failed' }),
        ]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="qratum"
      />,
    )

    expect(screen.getByText('1/1 authored done')).toBeInTheDocument()
    expect(screen.getByText('failed/stalled')).toBeInTheDocument()
    expect(screen.queryByText('review-P1-SPEC-HYGIENE')).not.toBeInTheDocument()
  })
})

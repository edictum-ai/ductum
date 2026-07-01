import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Agent, EnrichedRun, Repository, Spec, Task } from '@/api/client'
import { ProjectSpecsSection } from '@/components/project/ProjectSpecsSection'
import { renderWithProviders } from './test-utils'

const now = '2026-06-15T12:00:00.000Z'

function spec(index: number, overrides: Partial<Spec> = {}): Spec {
  const padded = String(index).padStart(2, '0')
  return {
    id: `spec-${padded}`,
    projectId: 'project1',
    name: `spec-${padded}`,
    status: 'approved',
    document: `Objective: Build the operator workflow for spec ${padded}.`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function task(specId: string, name: string, status = 'ready'): Task {
  return {
    id: `task-${name}`,
    specId,
    name,
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status,
    verification: [],
    createdAt: now,
    updatedAt: now,
  }
}

function run(specName: string, taskName: string, overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    id: `run-${specName}`,
    taskId: `task-${taskName}`,
    taskName,
    specName,
    projectName: 'ductum',
    agentId: 'agent1',
    agentName: 'Codex',
    agentModel: 'gpt-5.4',
    retryCount: 0,
    parentRunId: null,
    stage: 'done',
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
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

function renderSpecs(input: {
  specs: Spec[]
  tasks?: Task[]
  runs?: EnrichedRun[]
  repositories?: Repository[]
  agents?: Agent[]
}) {
  return renderWithProviders(
    <ProjectSpecsSection
      projectName="ductum"
      specs={input.specs}
      tasks={input.tasks ?? []}
      runs={input.runs ?? []}
      agents={input.agents ?? []}
      repositories={input.repositories ?? []}
    />,
  )
}

describe('ProjectSpecsSection', () => {
  it('renders safe summaries, task counts, attempt counts, and paginates large spec lists', () => {
    const specs = Array.from({ length: 12 }, (_, index) => spec(index + 1))
    const tasks = specs.map((item, index) => task(item.id, `P1-SPEC-${index + 1}`, index === 0 ? 'done' : 'ready'))
    const runs = [run('spec-01', 'P1-SPEC-1')]

    renderSpecs({ specs, tasks, runs })

    expect(screen.getByText('Build the operator workflow for spec 01.')).toBeInTheDocument()
    expect(screen.getByText('1/1 tasks done')).toBeInTheDocument()
    expect(screen.getByText('1 attempt')).toBeInTheDocument()
    expect(screen.getByText('1-10 of 12')).toBeInTheDocument()
    expect(screen.getByText('spec-10')).toBeInTheDocument()
    expect(screen.queryByText('spec-11')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('11-12 of 12')).toBeInTheDocument()
    expect(screen.getByText('spec-11')).toBeInTheDocument()
    expect(screen.getByText('spec-12')).toBeInTheDocument()
    expect(screen.queryByText('spec-01')).not.toBeInTheDocument()
  })

  it('filters specs by summary search and derived status', () => {
    const specs = [
      spec(1, { document: 'Objective: Build large-list search for project specs.' }),
      spec(2, { document: 'Objective: Retire stale factory warnings.' }),
      spec(3, { document: 'Objective: Make archived history readable.' }),
    ]
    const tasks = [
      task('spec-01', 'P1-LIST-SEARCH', 'ready'),
      task('spec-02', 'P1-FACTORY-WARNINGS', 'done'),
      task('spec-03', 'P1-HISTORY', 'ready'),
    ]

    renderSpecs({ specs, tasks })

    fireEvent.change(screen.getByLabelText('Search specs'), { target: { value: 'factory warnings' } })

    expect(screen.getByText('spec-02')).toBeInTheDocument()
    expect(screen.queryByText('spec-01')).not.toBeInTheDocument()
    expect(screen.getByText('1/3 visible')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search specs'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Filter specs by status'), { target: { value: 'done' } })

    expect(screen.getByText('spec-02')).toBeInTheDocument()
    expect(screen.queryByText('spec-01')).not.toBeInTheDocument()
    expect(screen.queryByText('spec-03')).not.toBeInTheDocument()
  })

  it('uses source fallbacks instead of exposing redacted source text', () => {
    renderSpecs({
      specs: [spec(1, {
        name: '[redacted]',
        document: 'token: [redacted]',
        source: {
          kind: 'github-issue',
          provider: 'github',
          repoOwner: 'edictum-ai',
          repoName: 'ductum',
          issueNumber: 212,
          issueUrl: 'https://github.com/edictum-ai/ductum/issues/212',
          title: 'Make project spec lists searchable',
          labels: ['bug'],
          importedAt: now,
          formId: 'ductum-work-item',
          parsed: {
            workType: 'fix',
            priority: 'P1',
            area: 'dashboard',
            blockers: [],
            objective: 'Make large project spec lists searchable and non-duplicative.',
            evidence: [],
            requirements: [],
            outOfScope: [],
            acceptanceCriteria: [],
            verificationCommands: [],
            safetyNotes: [],
          },
        },
      })],
      tasks: [task('spec-01', '[redacted]')],
    })

    expect(screen.getByText('Make large project spec lists searchable and non-duplicative.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edictum-ai\/ductum#212: Make project spec lists searchable/ })).toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
  })
})

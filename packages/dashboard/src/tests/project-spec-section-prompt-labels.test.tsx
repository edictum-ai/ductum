import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
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

function task(name: string, requiredRole: string | null = null, prompt = ''): Task {
  return {
    id: `task-${name}`,
    specId: 'spec1',
    name,
    prompt,
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

function renderSpecSection(element: ReactElement) {
  return render(<MemoryRouter>{element}</MemoryRouter>)
}

const reviewPrompt = [
  '## Review Task',
  '',
  'A different agent implemented the following task. Review their changes.',
  '',
  '### Original Task',
  '# P1: Webhook notification backend/runtime',
  '',
  '### Diff',
  '```diff',
  'diff with [redacted] context',
  '```',
].join('\n')

const fixPrompt = [
  '## Fix Task (Review Round 1)',
  '',
  '### Original Task',
  '# P1: Webhook notification backend/runtime',
  '',
  '### Review Feedback',
  'Whitespace broke around [redacted] context.',
].join('\n')

describe('Project SpecSection prompt-derived labels', () => {
  it('derives review and fix labels from prompt headings without losing role badges or routes', () => {
    const reviewTask: Task = {
      ...task('[redacted]', 'reviewer'),
      id: 'task-review-prompt-backed',
      prompt: reviewPrompt,
    }
    const fixTask: Task = {
      ...task('[redacted]', 'builder'),
      id: 'task-fix-prompt-backed',
      prompt: fixPrompt,
    }
    renderSpecSection(
      <SpecSection
        spec={spec()}
        tasks={[task('P1'), reviewTask, fixTask]}
        specRuns={[
          run('P1'),
          run('[redacted]', { id: 'run-review', taskId: 'task-review-prompt-backed' }),
          run('[redacted]', { id: 'run-fix', taskId: 'task-fix-prompt-backed' }),
        ]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="ductum"
      />,
    )

    fireEvent.click(screen.getByText('Show review loop'))

    const reviewChips = screen.getAllByRole('link', { name: /Review: Webhook notification backend/ })
    const fixChips = screen.getAllByRole('link', { name: /Fix: Webhook notification backend/ })
    expect(reviewChips.length).toBeGreaterThan(0)
    expect(fixChips.length).toBeGreaterThan(0)
    const reviewChip = reviewChips.find((node) => node.textContent?.includes('R1'))
    const fixChip = fixChips.find((node) => node.textContent?.includes('F1'))
    expect(reviewChip).toBeDefined()
    expect(fixChip).toBeDefined()
    // routes stay id-backed because the stored names are redacted.
    expect(reviewChip).toHaveAttribute('href', expect.stringContaining('/task-review-prompt-backed'))
    expect(fixChip).toHaveAttribute('href', expect.stringContaining('/task-fix-prompt-backed'))
    expect(reviewChip?.getAttribute('href')).not.toMatch(/Webhook|Review:/)
    expect(fixChip?.getAttribute('href')).not.toMatch(/Webhook|Fix:/)
    expect(reviewChip?.textContent).not.toMatch(/## Review Task|Original Task|\[redacted\]/i)
    expect(fixChip?.textContent).not.toMatch(/## Fix Task|Original Task|\[redacted\]/i)
  })

  it('falls back to the lineage name when the review prompt is malformed', () => {
    const malformedReviewPrompt = '## Review Task\n\nReview the diff.' // no Original Task section
    const reviewTask: Task = {
      ...task('review-P1-SAFE-NAME', 'reviewer'),
      prompt: malformedReviewPrompt,
    }
    renderSpecSection(
      <SpecSection
        spec={spec()}
        tasks={[task('P1'), reviewTask]}
        specRuns={[run('P1'), run('review-P1-SAFE-NAME')]}
        agents={[]}
        navigate={vi.fn() as never}
        projectName="ductum"
      />,
    )

    fireEvent.click(screen.getByText('Show review loop'))

    expect(screen.getAllByText('review-P1-SAFE-NAME').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Review: /)).not.toBeInTheDocument()
  })
})

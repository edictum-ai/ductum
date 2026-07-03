import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { SpecDetail } from '@/pages/SpecDetail'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

const now = '2026-06-15T12:00:00.000Z'
const older = '2026-06-15T10:00:00.000Z'

function project() {
  return {
    id: 'project1',
    name: 'Ductum Core',
    repos: [],
    config: { mergeMode: 'auto', workflowPath: 'coding-guard' },
    factoryId: 'factory1',
    createdAt: older,
    updatedAt: now,
  }
}

function spec(overrides: Record<string, unknown> = {}) {
  return {
    id: 'spec1',
    projectId: 'project1',
    name: 'truthful-spec',
    status: 'approved',
    document: 'Make spec detail honest.',
    createdAt: older,
    updatedAt: now,
    ...overrides,
  }
}

function task(name: string, status = 'done') {
  return {
    id: `task-${name}`,
    specId: 'spec1',
    name,
    prompt: '',
    repos: [],
    assignedAgentId: null,
    requiredRole: null,
    complexity: null,
    status,
    verification: [],
    createdAt: older,
    updatedAt: now,
  }
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'decision1',
    specId: 'spec1',
    taskId: null,
    runId: null,
    decision: 'Imported Spec Decision Trace: [redacted] / decisions/053',
    context: 'Context includes [redacted] source path.',
    alternatives: null,
    decidedBy: 'Arnold',
    supersedesId: null,
    createdAt: now,
    ...overrides,
  }
}

function renderSpecDetail(route = '/Ductum%20Core/truthful-spec') {
  return renderWithProviders(
    <Routes>
      <Route path="/:project/:spec" element={<SpecDetail />} />
    </Routes>,
    { route },
  )
}

afterEach(() => {
  fetchHelper?.restore()
})

describe('SpecDetail redaction display', () => {
  it('uses fallbacks for redacted spec and task labels', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/%5Bredacted%5D': {
        project: project(),
        spec: spec({
          name: '[redacted]',
          source: {
            kind: 'github-issue',
            provider: 'github',
            repoOwner: 'edictum-ai',
            repoName: 'ductum',
            issueNumber: 125,
            issueUrl: 'https://github.com/edictum-ai/ductum/issues/125',
            title: 'fix(provider-auth): [redacted]',
            labels: [],
            importedAt: now,
            formId: 'ductum-work-item',
            parsed: {
              workType: 'fix',
              priority: 'P1',
              area: 'auth',
              blockers: [],
              objective: '[redacted]',
              evidence: [],
              requirements: [],
              outOfScope: [],
              acceptanceCriteria: [],
              verificationCommands: [],
              safetyNotes: [],
            },
          },
        }),
      },
      '/api/specs/spec1/tasks': [{ ...task('[redacted]', 'ready'), id: 'task-redacted-123456' }],
      '/api/agents': [],
      '/api/decisions': [],
      '/api/runs': [],
    })

    renderSpecDetail('/Ductum%20Core/%5Bredacted%5D')

    expect(await screen.findAllByText('edictum-ai/ductum#125')).not.toHaveLength(0)
    await waitFor(() => expect(screen.getByText(/IMPL task task-r/)).toBeInTheDocument())
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
  })

  it('uses fallbacks for redacted imported decision trace labels', async () => {
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': { project: project(), spec: spec() },
      '/api/specs/spec1/tasks': [task('build', 'ready')],
      '/api/agents': [],
      '/api/decisions': [decision()],
      '/api/runs': [],
    })

    renderSpecDetail()

    expect(await screen.findByText('Imported spec decision trace')).toBeInTheDocument()
    expect(screen.getByText('Context hidden because it contains redacted source text.')).toBeInTheDocument()
    expect(screen.queryByText(/\[redacted\]/)).not.toBeInTheDocument()
  })

  it('derives useful labels from review and fix prompts without leaking prompt wrappers', async () => {
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
    fetchHelper = mockFetch({
      '/api/resolve/Ductum%20Core/truthful-spec': { project: project(), spec: spec() },
      '/api/specs/spec1/tasks': [
        { ...task('[redacted]', 'ready'), id: 'task-review-prompt-backed', requiredRole: 'reviewer', prompt: reviewPrompt },
        { ...task('[redacted]', 'ready'), id: 'task-fix-prompt-backed', requiredRole: 'builder', prompt: fixPrompt },
      ],
      '/api/agents': [],
      '/api/decisions': [],
      '/api/runs': [],
    })

    renderSpecDetail()

    expect(await screen.findByText('Review: Webhook notification backend/runtime')).toBeInTheDocument()
    expect(screen.getByText('Fix: Webhook notification backend/runtime')).toBeInTheDocument()
    expect(screen.queryByText(/## Review Task|## Fix Task|Original Task|\[redacted\]/i)).not.toBeInTheDocument()
  })
})

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ProjectDetail } from '@/pages/ProjectDetail'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined
const now = '2026-06-14T12:00:00.000Z'

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('Project detail context', () => {
  it('shows who the project is for and what imported specs want', async () => {
    fetchHelper = mockFetch(projectDetailResponses())
    renderProject()

    expect(await screen.findByText('Project context')).toBeInTheDocument()
    expect(screen.getAllByText('Coordinate governed agent work across gateway.')).toHaveLength(2)
    expect(screen.getAllByText('Developers, reviewers, and operators responsible for gateway.')).toHaveLength(2)
    expect(await screen.findByText('Build the gateway foundation without exposing raw secrets.')).toBeInTheDocument()
    expect(screen.getByText('edictum-ai/personal-memory#12')).toBeInTheDocument()
    expect(screen.queryByText('token: [redacted]')).not.toBeInTheDocument()
  })

  it('gives ProjectDetail a meaningful h1 to h2 section heading hierarchy', async () => {
    fetchHelper = mockFetch(projectDetailResponses())
    renderProject()

    // h1: the project name (PageHeader renders this as a real heading)
    expect(await screen.findByRole('heading', { name: 'personal-memory', level: 1 })).toBeInTheDocument()
    // h2: each major project section is a real heading so operators can scan.
    // Use findByRole because the sections render after the project's
    // repositories/specs/tasks/runs fetches resolve.
    expect(await screen.findByRole('heading', { name: 'Project context', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Under this project', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Specs', level: 2 })).toBeInTheDocument()
  })

  it('updates explicit project purpose and audience', async () => {
    fetchHelper = mockFetch({
      ...projectDetailResponses(),
      'PUT /api/projects/p1': {
        ...project(),
        config: {
          mergeMode: 'human',
          workflowPath: '',
          purpose: 'Keep the memory gateway trustworthy.',
          audience: 'Gateway maintainers.',
        },
      },
    })
    renderProject()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit project' }))
    fireEvent.change(await screen.findByTestId('project-purpose-input'), { target: { value: 'Keep the memory gateway trustworthy.' } })
    fireEvent.change(screen.getByTestId('project-audience-input'), { target: { value: 'Gateway maintainers.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save project' }))

    await waitFor(() => expect(callsOf(fetchHelper!, 'PUT', '/api/projects/p1')).toHaveLength(1))
    expect(requestBody(callsOf(fetchHelper!, 'PUT', '/api/projects/p1')[0]!)).toMatchObject({
      config: {
        mergeMode: 'human',
        purpose: 'Keep the memory gateway trustworthy.',
        audience: 'Gateway maintainers.',
      },
    })
  })
})

function renderProject() {
  renderWithProviders(
    <Routes><Route path="/:project" element={<ProjectDetail />} /></Routes>,
    { route: '/personal-memory' },
  )
}

function project() {
  return {
    id: 'p1',
    factoryId: 'f1',
    name: 'personal-memory',
    repos: ['/repo/gateway'],
    config: { mergeMode: 'human', workflowPath: '' },
    createdAt: now,
    updatedAt: now,
  }
}

function projectDetailResponses() {
  return {
    '/api/resolve/personal-memory': { project: project() },
    '/api/projects/p1/agents': [],
    '/api/projects/p1/repositories': [{
      id: 'repo1',
      projectId: 'p1',
      name: 'gateway',
      portable: true,
      spec: { localPath: '/repo/gateway', defaultBranch: 'main' },
      readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: true },
      components: [],
    }],
    '/api/agents': [],
    '/api/projects/p1/specs': [{
      id: 's1',
      projectId: 'p1',
      name: 'gateway-foundation',
      status: 'approved',
      document: 'token: [redacted]',
      source: issueSource(),
      createdAt: now,
      updatedAt: now,
    }],
    '/api/projects/p1/tasks': [{
      id: 't1',
      specId: 's1',
      name: 'P1-GATEWAY-PHASE-1',
      prompt: '',
      repos: [],
      assignedAgentId: null,
      requiredRole: null,
      complexity: null,
      status: 'ready',
      verification: [],
      createdAt: now,
      updatedAt: now,
    }],
    '/api/projects/p1/runs': [],
    '/api/factory/operator-brief': {
      generatedAt: now,
      dispatcher: { enabled: true, running: true, activeRuns: 0, maxConcurrentRuns: 4, lastCycleAt: now, adapterCount: 1 },
      queue: { approvalsWaiting: 0, activeRuns: 0, readyTasks: 0, needsOperator: 0, needsOperatorAttempts: [], integrityIssues: 0 },
      telegram: { enabled: false, configured: false },
      agents: [],
      recommendedActions: [],
    },
  }
}

function issueSource() {
  return {
    kind: 'github-issue',
    provider: 'github',
    repoOwner: 'edictum-ai',
    repoName: 'personal-memory',
    issueNumber: 12,
    issueUrl: 'https://github.com/edictum-ai/personal-memory/issues/12',
    title: 'Gateway foundation',
    labels: ['gateway'],
    importedAt: now,
    formId: 'ductum-work-item',
    parsed: {
      workType: 'feat',
      priority: 'P1',
      area: 'gateway',
      blockers: [],
      objective: 'Build the gateway foundation without exposing raw secrets.',
      evidence: [],
      requirements: ['Show the gateway purpose before attempt history.'],
      outOfScope: [],
      acceptanceCriteria: [],
      verificationCommands: [],
      safetyNotes: [],
    },
  }
}

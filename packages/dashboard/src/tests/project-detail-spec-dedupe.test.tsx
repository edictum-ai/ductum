import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ProjectDetail } from '@/pages/ProjectDetail'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('Project detail spec list', () => {
  it('does not duplicate specs through active/history run groups', async () => {
    fetchHelper = mockFetch(projectDetailResponses())

    renderWithProviders(
      <Routes><Route path="/:project" element={<ProjectDetail />} /></Routes>,
      { route: '/personal-memory' },
    )

    expect(await screen.findByRole('link', { name: /gateway-foundation/ })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /gateway-foundation/ })).toHaveLength(1)
    expect(screen.queryByText('Active work')).not.toBeInTheDocument()
    expect(screen.queryByText('History')).not.toBeInTheDocument()
  })
})

function projectDetailResponses() {
  const now = '2026-06-14T12:00:00.000Z'
  return {
    '/api/resolve/personal-memory': {
      project: {
        id: 'p1',
        factoryId: 'f1',
        name: 'personal-memory',
        repos: ['/repo/gateway'],
        config: { mergeMode: 'human', workflowPath: '' },
        createdAt: now,
        updatedAt: now,
      },
    },
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
      document: 'Objective: Build gateway foundations.',
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
      status: 'done',
      verification: [],
      createdAt: now,
      updatedAt: now,
    }],
    '/api/runs?limit=500': [{
      id: 'run1',
      taskId: 't1',
      taskName: 'P1-GATEWAY-PHASE-1',
      specName: 'gateway-foundation',
      projectName: 'personal-memory',
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
    }],
  }
}

import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { Projects } from '@/pages/Projects'
import { operatorBrief } from './command-palette-test-data'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('Projects clean done signal', () => {
  it('does not show a positive done signal for integrity-flagged done attempts', async () => {
    const now = '2026-06-16T12:00:00.000Z'
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p-integrity', factoryId: 'f1', name: 'integrity-project', repos: [], config: { mergeMode: 'human', workflowPath: '' }, createdAt: now, updatedAt: now },
      ],
      '/api/projects/p-integrity/specs': [],
      '/api/projects/p-integrity/tasks': [],
      '/api/factory/operator-brief': operatorBrief(),
      '/api/runs?limit=500': [{
        id: 'run_integrity_done',
        taskId: 'task_1',
        projectName: 'integrity-project',
        specName: 'spec',
        taskName: 'task',
        agentName: 'builder',
        agentModel: 'gpt-5.4',
        stage: 'done',
        terminalState: null,
        failReason: null,
        blockedReason: null,
        pendingApproval: false,
        branch: null,
        prNumber: null,
        prUrl: null,
        commitSha: null,
        worktreePaths: [],
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 12,
        lastHeartbeat: now,
        createdAt: now,
        updatedAt: now,
        executionMode: 'inconsistent',
        executionIssues: [{ code: 'done_run_without_lineage_or_external_outcome', message: 'Missing lineage.' }],
      }],
    })

    renderWithProviders(
      <Routes>
        <Route path="/projects" element={<Projects />} />
      </Routes>,
      { route: '/projects' },
    )

    expect(await screen.findByText('integrity-project')).toBeInTheDocument()
    expect(screen.getByText('1 past failed/stalled')).toBeInTheDocument()
    expect(screen.getByText('$12.00 · no clean done yet')).toBeInTheDocument()
    expect(screen.queryByText(/1 (clean )?done/)).not.toBeInTheDocument()
  })

  it('does not double-count non-terminal integrity issues as approval work', async () => {
    const now = '2026-06-16T12:00:00.000Z'
    fetchHelper = mockFetch({
      '/api/projects': [
        { id: 'p-integrity', factoryId: 'f1', name: 'integrity-project', repos: [], config: { mergeMode: 'human', workflowPath: '' }, createdAt: now, updatedAt: now },
      ],
      '/api/projects/p-integrity/specs': [],
      '/api/projects/p-integrity/tasks': [],
      '/api/factory/operator-brief': operatorBrief(),
      '/api/runs?limit=500': [{
        id: 'run_integrity_approval',
        taskId: 'task_1',
        projectName: 'integrity-project',
        specName: 'spec',
        taskName: 'task',
        agentName: 'builder',
        agentModel: 'gpt-5.4',
        stage: 'ship',
        terminalState: null,
        failReason: null,
        blockedReason: null,
        pendingApproval: true,
        branch: null,
        prNumber: null,
        prUrl: null,
        commitSha: null,
        worktreePaths: [],
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 12,
        lastHeartbeat: now,
        createdAt: now,
        updatedAt: now,
        executionMode: 'inconsistent',
        executionIssues: [{ code: 'final_evidence_on_non_done_run', message: 'Final evidence exists before done.' }],
      }],
    })

    renderWithProviders(
      <Routes>
        <Route path="/projects" element={<Projects />} />
      </Routes>,
      { route: '/projects' },
    )

    expect(await screen.findByText('integrity-project')).toBeInTheDocument()
    expect(screen.getByText('1 past failed/stalled')).toBeInTheDocument()
    expect(screen.queryByText('1 awaiting approval')).not.toBeInTheDocument()
  })
})

import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DesktopSidebar } from '@/components/Sidebar'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

describe('Sidebar week spend', () => {
  afterEach(() => {
    fetchHelper?.restore()
    fetchHelper = undefined
  })

  it('shows tracked spend with an honest label and no fake budget fill', async () => {
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/runs?limit=200': [
        {
          id: 'r1',
          stage: 'done',
          terminalState: null,
          pendingApproval: false,
          costUsd: 12.34,
          createdAt: now,
          updatedAt: now,
          taskId: 't1',
          agentId: 'a1',
          parentRunId: null,
          resetCount: 0,
          completedStages: [],
          blockedReason: null,
          sessionId: null,
          branch: null,
          commitSha: null,
          prNumber: null,
          prUrl: null,
          worktreePaths: [],
          ciStatus: null,
          reviewStatus: null,
          failReason: null,
          recoverable: true,
          tokensIn: 0,
          tokensOut: 0,
          lastHeartbeat: null,
          heartbeatTimeoutSeconds: 300,
          completionSummary: null,
          taskName: 'task',
          specName: 'spec',
          projectName: 'proj',
          agentName: 'Agent',
          agentModel: null,
          retryCount: 0,
          executionMode: 'orchestrated',
          executionIssues: [],
        },
        {
          id: 'r2',
          stage: 'done',
          terminalState: null,
          pendingApproval: false,
          costUsd: 12.34,
          createdAt: now,
          updatedAt: now,
          taskId: 't2',
          agentId: 'a1',
          parentRunId: null,
          resetCount: 0,
          completedStages: [],
          blockedReason: null,
          sessionId: null,
          branch: null,
          commitSha: null,
          prNumber: null,
          prUrl: null,
          worktreePaths: [],
          ciStatus: null,
          reviewStatus: null,
          failReason: null,
          recoverable: true,
          tokensIn: 0,
          tokensOut: 0,
          lastHeartbeat: null,
          heartbeatTimeoutSeconds: 300,
          completionSummary: null,
          taskName: 'task with integrity issue',
          specName: 'spec',
          projectName: 'proj',
          agentName: 'Agent',
          agentModel: null,
          retryCount: 0,
          executionMode: 'inconsistent',
          executionIssues: [{ code: 'done_run_without_lineage_or_external_outcome', message: 'Missing lineage.' }],
        },
      ],
      '/api/runs?stage=ship': [],
      '/api/factory/operator-brief': {
        queue: { approvalsWaiting: 0, activeRuns: 0, readyTasks: 0, needsOperator: 2, integrityIssues: 0 },
      },
      '/api/repair': {
        summary: { total: 5, blockers: 3, attention: 2, byArea: {} },
        items: [],
        groups: [],
        generatedAt: now,
      },
    })
    renderWithProviders(<DesktopSidebar />, { route: '/' })

    await waitFor(() => {
      expect(screen.getByText('Tracked spend this week')).toBeInTheDocument()
      expect(screen.getByText('$24.68/clean done · +$24.68 vs prior week')).toHaveAttribute('title', 'Clean done means done attempts without execution-integrity issues.')
    })
	    expect(screen.getByRole('link', { name: 'Open Factory Activity' })).toHaveAttribute('href', '/activity')
	    const nav = screen.getByRole('navigation', { name: 'Primary' })
	    expect(within(within(nav).getByRole('link', { name: /Factory Activity/ })).getByText('2')).toBeInTheDocument()
	    expect(within(within(nav).getByRole('link', { name: /Repair/ })).getByText('3')).toBeInTheDocument()
    expect(screen.queryByText(/budget/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()

    const sidebar = document.querySelector('aside') ?? document
    const bars = sidebar.querySelectorAll<HTMLDivElement>('div[style*="height: 3px"]')
    expect(bars.length).toBeGreaterThanOrEqual(1)
  })
})

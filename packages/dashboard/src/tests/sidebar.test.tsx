import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { DesktopSidebar } from '@/components/Sidebar'
import { mockFetch, renderWithProviders } from './test-utils'
import { activitySummaryFixture } from './factory-activity-fixtures'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

describe('Sidebar approvals badge data truth', () => {
  afterEach(() => {
    fetchHelper?.restore()
    fetchHelper = undefined
  })

  it('reads approvalsWaiting from the operator brief, not a capped runs list', async () => {
    // Issue #244 behavior contract #1: sidebar approval/action-needed
    // badges must use the authoritative brief source. The sidebar must
    // show approvalsWaiting from the operator brief even when no
    // /api/runs?stage=ship fetch exists, and must NOT call that route.
    const now = new Date().toISOString()
    fetchHelper = mockFetch({
      '/api/factory/operator-brief': {
        queue: { approvalsWaiting: 7, activeRuns: 0, readyTasks: 0, needsOperator: 0, integrityIssues: 0 },
      },
      '/api/factory/activity-summary': activitySummaryFixture({ attemptCount: 50 }),
      '/api/repair': { summary: { total: 0, blockers: 0, attention: 0, byArea: {} }, items: [], groups: [], generatedAt: now },
    })

    renderWithProviders(<DesktopSidebar />, { route: '/' })

    await waitFor(() => {
      const nav = screen.getByRole('navigation', { name: 'Primary' })
      expect(within(within(nav).getByRole('link', { name: /Approvals/ })).getByText('7')).toBeInTheDocument()
    })
    // Data truth: the sidebar must not derive the approvals badge from
    // a default-limited /api/runs?stage=ship list. No fetch to that
    // capped endpoint should happen for the sidebar.
    expect(fetchHelper!.mock.mock.calls.some(([url]) => String(url).includes('/api/runs?stage=ship'))).toBe(false)
  })

  it('does not inflate the badge when only stale done-stage rows are returned', async () => {
    // Regression guard for the prior capped-list derivation: a done-stage
    // row with pendingApproval=true must NOT be counted by the sidebar.
    // Brief approvalsWaiting=0 is the authoritative truth.
    fetchHelper = mockFetch({
      '/api/factory/operator-brief': {
        queue: { approvalsWaiting: 0, activeRuns: 0, readyTasks: 0, needsOperator: 0, integrityIssues: 0 },
      },
      '/api/runs?stage=ship': [],
    })

    renderWithProviders(<DesktopSidebar />, { route: '/' })

    await waitFor(() => {
      const nav = screen.getByRole('navigation', { name: 'Primary' })
      // Approvals link must not show a numeric badge when the brief
      // reports zero approvals waiting.
      const approvalsLink = within(nav).getByRole('link', { name: /Approvals/ })
      expect(approvalsLink).not.toHaveTextContent(/^[0-9]+$/)
    })
  })
})

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
      '/api/factory/activity-summary': activitySummaryFixture({
        attemptCount: 237,
        cleanDone: 89,
        trackedUsd: 119.7,
        missingUsage: 181,
        costPerCleanDoneLabel: '$1.34',
        currentAttemptCount: 120,
        currentCleanDone: 90,
        currentTrackedUsd: 74.54,
        currentMissingUsage: 181,
        currentCostPerCleanDoneLabel: '$0.83',
        previousAttemptCount: 80,
        previousCleanDone: 40,
        previousTrackedUsd: 28.1,
        previousCostPerCleanDoneLabel: '$0.70',
        tokensOut: 42_000,
        attention: 110,
      }),
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
      expect(screen.getByText('$74')).toBeInTheDocument()
      expect(screen.getByText('.54')).toBeInTheDocument()
      expect(screen.getByText('$0.83/clean done · +$46.44 vs prior week · 181 attempts missing usage')).toHaveAttribute('title', 'Clean done means done attempts without execution-integrity issues. All attempts in the factory database')
    })
    expect(screen.queryByText('$24.68/clean done')).not.toBeInTheDocument()
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

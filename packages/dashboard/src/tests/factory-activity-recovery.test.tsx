import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { EnrichedRun } from '@/api/client'
import { FactoryActivity } from '@/pages/FactoryActivity'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

describe('FactoryActivity recovery surface', () => {
  it('shows attempts needing operator action as a primary recovery section', async () => {
    const stalled = activityAttempt({
      id: 'mmq_X40JI10x',
      projectName: 'personal-memory',
      specName: 'P1-GATEWAY-PHASE-1',
      taskName: 'P1-BUILD-GATEWAY',
      agentName: 'codex-builder',
      agentModel: 'gpt-5.4',
      terminalState: 'stalled',
      failReason: 'Checkpoint resume unavailable across server restart.',
      worktreePaths: ['/tmp/ductum-worktrees/mmq_X40JI10x'],
    })
    fetchHelper = mockFetch({ '/api/attempts?limit=500': { attempts: [stalled] } })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    })
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent)
    const needsIndex = headings.indexOf('Needs attention')
    const readyIndex = headings.indexOf('Ready to dispatch')
    expect(needsIndex).toBeGreaterThanOrEqual(0)
    expect(readyIndex).toBeGreaterThanOrEqual(0)
    expect(needsIndex).toBeLessThan(readyIndex)
    expect(screen.queryByRole('heading', { name: 'Attention clear' })).not.toBeInTheDocument()
    const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section')
    expect(section).not.toBeNull()
    expect(within(section as HTMLElement).getByText('personal-memory')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('P1-GATEWAY-PHASE-1')).toBeInTheDocument()
    expect(within(section as HTMLElement).getAllByText('P1-BUILD-GATEWAY').length).toBeGreaterThan(0)
    expect(within(section as HTMLElement).getByText('mmq_X40JI10x')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('codex-builder (gpt-5.4)')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('Stalled')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText('Implementing')).toBeInTheDocument()
    expect(within(section as HTMLElement).getByText(/Checkpoint resume unavailable/)).toBeInTheDocument()
  })

  it('puts inspect commands before cautious retry guidance', async () => {
    fetchHelper = mockFetch({
      '/api/attempts?limit=500': { attempts: [activityAttempt({
        id: '62VM_sKAICEF',
        terminalState: 'stalled',
        projectName: 'qratum',
        specName: 'P1-SPEC-HYGIENE',
        taskName: 'P1-SPEC-HYGIENE',
        worktreePaths: [],
      })] },
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    })
    const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section') as HTMLElement
    const text = section.textContent ?? ''
    expect(text.indexOf('ductum status 62VM_sKAICEF')).toBeGreaterThan(-1)
    expect(text.indexOf('ductum logs 62VM_sKAICEF')).toBeGreaterThan(text.indexOf('ductum status 62VM_sKAICEF'))
    expect(text.indexOf('ductum retry 62VM_sKAICEF')).toBeGreaterThan(text.indexOf('Retry only after inspecting logs'))
    expect(section).toHaveTextContent(/Treat retry as unsafe/)
    expect(within(section).getByRole('link', { name: 'Open attempt detail' })).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: 'Copy to clipboard' }).length).toBeGreaterThanOrEqual(4)
  })

  it('uses execution issues instead of completion summaries for integrity attention rows', async () => {
    fetchHelper = mockFetch({
      '/api/attempts?limit=500': { attempts: [activityAttempt({
        id: 'integrity_done_1',
        stage: 'done',
        terminalState: null,
        failReason: null,
        blockedReason: null,
        completionSummary: 'Ready to merge.',
        executionMode: 'inconsistent',
        executionIssues: [{ code: 'final_evidence_on_non_done_run', message: 'Final review evidence exists before the attempt was closed.' }],
      })] },
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    })
    const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section') as HTMLElement
    expect(section).toHaveTextContent('Inconsistent: 1 issue')
    expect(section).toHaveTextContent('Final evidence on an unfinished attempt')
    expect(section).not.toHaveTextContent('Ready to merge.')
    expect(section).not.toHaveTextContent('ductum retry integrity_done_1')
    expect(section).toHaveTextContent(/not a retry prompt/)
  })

  it('renders an honest empty attention state when nothing needs attention', async () => {
    fetchHelper = mockFetch({ '/api/attempts?limit=500': { attempts: [] } })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory Activity' })).toBeInTheDocument()
    })
    const section = screen.getByRole('heading', { name: 'Attention clear' }).closest('section') as HTMLElement
    expect(section).toHaveTextContent('0')
    expect(section).toHaveTextContent('No fetched run rows currently require operator action.')
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.getByText('All clear · no attempts are running.')).toBeInTheDocument()
    expect(screen.getByText('All clear · no attempts are awaiting approval.')).toBeInTheDocument()
    expect(screen.getByText('No completed attempts in the fetched window.')).toBeInTheDocument()
    expect(section).not.toHaveTextContent('14')
  })

  it('explains when the operator brief count is broader than visible run rows', async () => {
    fetchHelper = mockFetch({
      '/api/factory/operator-brief': operatorBrief({ readyTasks: 0, needsOperator: 14 }),
      '/api/attempts?limit=500': { attempts: [] },
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
    })
    const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section') as HTMLElement
    expect(section).toHaveTextContent('0 shown / 14 reported')
    expect(section).toHaveTextContent('Operator brief reports 14 attention items')
    expect(section).toHaveTextContent('none are visible in the fetched run list')
    expect(screen.queryByRole('heading', { name: 'Attention clear' })).not.toBeInTheDocument()
  })

  it('does not count superseded failed lineage attempts as live operator work', async () => {
    fetchHelper = mockFetch({
      '/api/factory/operator-brief': operatorBrief({ readyTasks: 1, needsOperator: 0 }),
      '/api/attempts?limit=500': { attempts: [
        activityAttempt({
          id: 'old_failed_review',
          terminalState: 'failed',
          failReason: 'Retried by operator',
          executionMode: 'recorded',
          updatedAt: '2026-06-14T13:00:00.000Z',
          taskName: 'review-P1-GATEWAY-PHASE-1',
        }),
        activityAttempt({
          id: 'current_review',
          stage: 'review',
          terminalState: null,
          failReason: null,
          executionMode: 'orchestrated',
          updatedAt: '2026-06-14T13:10:00.000Z',
          taskName: 'review-P1-GATEWAY-PHASE-1',
        }),
      ] },
    })

    renderWithProviders(<FactoryActivity />, { route: '/activity' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Factory Activity' })).toBeInTheDocument()
    })
    const section = screen.getByRole('heading', { name: 'Attention clear' }).closest('section') as HTMLElement
    expect(section).toHaveTextContent('Fetched runs and operator brief both show 0 attention items.')
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Running attempts' })).toBeInTheDocument()
    expect(screen.getAllByText('review-P1-GATEWAY-PHASE-1')).toHaveLength(1)
    expect(screen.queryByText('Retried by operator')).not.toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
  })
})

function operatorBrief(queue: { readyTasks: number; needsOperator: number }) {
  return {
    generatedAt: '2026-06-14T13:00:00.000Z',
    staleSlotsAutoClosed: 0,
    dispatcher: {
      enabled: true,
      running: true,
      activeRuns: 0,
      maxConcurrentRuns: 4,
      lastCycleAt: '2026-06-14T13:00:00.000Z',
      adapterCount: 1,
    },
    queue: {
      approvalsWaiting: 0,
      activeRuns: 0,
      readyTasks: queue.readyTasks,
      needsOperator: queue.needsOperator,
      integrityIssues: 0,
    },
    integrity: {
      readiness: 'clear',
      issueCount: 0,
      taskIssueCount: 0,
      runIssueCount: 0,
      externalTaskCount: 0,
      externalRunCount: 0,
      taskModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      runModes: { orchestrated: 0, external: 0, recorded: 0, unknown: 0, inconsistent: 0 },
      issues: [],
      issuesTruncated: false,
    },
    telegram: { enabled: false, configured: false },
    agents: [],
    recommendedActions: [],
  }
}

function activityAttempt(overrides: Partial<EnrichedRun>): EnrichedRun {
  const now = '2026-06-14T13:00:00.000Z'
  return {
    id: 'attempt_0',
    taskId: 'task_0',
    agentId: 'agent_0',
    parentRunId: null,
    stage: 'implement',
    terminalState: 'failed',
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: [],
    ciStatus: null,
    reviewStatus: null,
    failReason: 'attempt needs operator attention',
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 300,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
    taskName: 'task',
    specName: 'spec',
    projectName: 'project',
    agentName: 'codex',
    agentModel: '',
    retryCount: 0,
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    ...overrides,
  } as EnrichedRun
}

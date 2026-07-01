import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { EnrichedRun, ExecutionIntegrityIssueSample } from '@/api/client'
import { IntegrityIssueList } from '@/components/homepage/IntegrityIssueList'
import { HomepageLiveStreamCard } from '@/components/homepage/HomepageLiveStreamCard'
import { HomepageTodayPanel, readLegacyHomeLastSeen } from '@/components/homepage/HomepageTodayPanel'
import { MetricPill } from '@/components/signal'
import { activitySummaryFixture } from './factory-activity-fixtures'

describe('Homepage status presentation', () => {
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('orders active integrity issues before historical done issues and links rows', () => {
    const historical = issue({ id: 'task_done', status: 'done', taskName: 'P0-DONE' })
    const active = issue({ id: 'task_blocked', status: 'blocked', taskName: 'P1-BLOCKED' })

    render(
      <MemoryRouter>
        <IntegrityIssueList issues={[historical, active]} />
      </MemoryRouter>,
    )

    const rows = screen.getAllByRole('link')
    expect(rows[0]).toHaveTextContent('P1-BLOCKED')
    expect(rows[0]).toHaveAttribute('href', '/qratum/milestone-a/P1-BLOCKED')
    expect(rows[1]).toHaveTextContent('Historical Done')
  })

  it('marks older failed attempts as superseded when a newer lineage run exists', () => {
    render(
      <MemoryRouter>
        <HomepageLiveStreamCard
          runs={[
            run({
              id: 'failed_run_123456',
              stage: 'failed',
              terminalState: 'failed',
              updatedAt: '2026-05-22T08:00:00Z',
            }),
            run({
              id: 'done_run_123456',
              stage: 'done',
              terminalState: null,
              updatedAt: '2026-05-22T09:00:00Z',
            }),
          ]}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText(/superseded/i)).toBeInTheDocument()
    expect(screen.getByText(/done/i)).toBeInTheDocument()
    expect(screen.getAllByText(/qratum · milestone-a · codex/i)).toHaveLength(2)
  })

  it('hides toned zero metric pills by default unless hideZero is disabled', () => {
    const { rerender } = render(<MetricPill label="attention" value={0} tone="warn" />)

    expect(screen.queryByText('attention')).not.toBeInTheDocument()

    rerender(<MetricPill label="catalog gaps" value={0} tone="warn" hideZero={false} />)
    expect(screen.getByText('catalog gaps')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('does not mark Home seen during route remount until the exit timer fires', () => {
    const previous = '2026-06-15T10:00:00.000Z'
    const onMarkSeen = vi.fn()

    const first = render(<HomepageTodayPanel factoryName="Test" runs={[]} lastSeenAt={previous} onMarkSeen={onMarkSeen} />)
    expect(screen.getByText(/Since you last looked/)).toHaveTextContent('no new attempt activity')
    expect(onMarkSeen).not.toHaveBeenCalled()

    first.unmount()
    render(<HomepageTodayPanel factoryName="Test" runs={[]} lastSeenAt={previous} onMarkSeen={onMarkSeen} />)

    expect(onMarkSeen).not.toHaveBeenCalled()
  })

  it('records the Home exit time through the durable callback', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T11:30:00.000Z'))
    const previous = '2026-06-15T10:00:00.000Z'
    const onMarkSeen = vi.fn()

    const view = render(<HomepageTodayPanel factoryName="Test" runs={[]} lastSeenAt={previous} onMarkSeen={onMarkSeen} />)
    expect(onMarkSeen).not.toHaveBeenCalled()

    view.unmount()
    expect(onMarkSeen).not.toHaveBeenCalled()

    vi.runOnlyPendingTimers()
    expect(onMarkSeen).toHaveBeenCalledWith('2026-06-15T11:30:00.000Z')
  })

  it('does not treat React StrictMode effect replay as leaving Home', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T11:30:00.000Z'))
    const previous = '2026-06-15T10:00:00.000Z'
    const onMarkSeen = vi.fn()

    const view = render(
      <StrictMode>
        <HomepageTodayPanel factoryName="Test" runs={[]} lastSeenAt={previous} onMarkSeen={onMarkSeen} />
      </StrictMode>,
    )

    vi.runOnlyPendingTimers()
    expect(onMarkSeen).not.toHaveBeenCalled()

    view.unmount()
    vi.runOnlyPendingTimers()
    expect(onMarkSeen).toHaveBeenCalledWith('2026-06-15T11:30:00.000Z')
  })

  it('canonicalizes legacy Home last-look values before migration', () => {
    localStorage.setItem('ductum.home.lastSeenAt', '2026-06-16T12:00:00Z')

    expect(readLegacyHomeLastSeen()).toBe('2026-06-16T12:00:00.000Z')
  })

  it('labels clean done attempts without claiming merge evidence', () => {
    render(<HomepageTodayPanel factoryName="Test" runs={[run({ id: 'done_1', costUsd: 2.5 })]} activitySummary={activitySummaryFixture()} />)

    expect(screen.getByText('Clean done')).toBeInTheDocument()
    expect(screen.getByText('Cost / clean done')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByText('100% done without integrity issues')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Merge rate|Cost \/ merge|clean merged/i)
  })

  it('uses the uncapped activity summary for factory health when capped runs disagree', () => {
    render(
      <MemoryRouter>
        <HomepageTodayPanel
          factoryName="Test"
          runs={[run({ id: 'capped_1', costUsd: 999 }), run({ id: 'capped_2', costUsd: 999 })]}
          activitySummary={activitySummaryFixture({
            attemptCount: 237,
            cleanDone: 89,
            trackedUsd: 119.7,
            currentTrackedUsd: 74.54,
            missingUsage: 181,
            costPerCleanDoneLabel: '$1.34',
          })}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('89/237')).toBeInTheDocument()
    expect(screen.getByText('$1.34')).toBeInTheDocument()
    expect(screen.getByText('181/237')).toBeInTheDocument()
    expect(document.body).toHaveTextContent('All attempts in the factory database')
    expect(document.body).not.toHaveTextContent('$999')
  })
})

function issue(overrides: Partial<ExecutionIntegrityIssueSample>): ExecutionIntegrityIssueSample {
  return {
    scope: 'task',
    id: 'task_1',
    projectName: 'qratum',
    specName: 'milestone-a',
    taskName: 'P0',
    runId: null,
    executionMode: 'inconsistent',
    issueCode: 'done_task_without_lineage_or_external_outcome',
    issueMessage: 'Done task has no lineage.',
    status: 'done',
    ...overrides,
  }
}

function run(overrides: Partial<EnrichedRun>): EnrichedRun {
  return {
    id: 'run_1',
    taskId: 'task_1',
    agentId: 'codex',
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
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: '2026-05-22T08:00:00Z',
    updatedAt: '2026-05-22T08:00:00Z',
    executionMode: 'orchestrated',
    executionIssues: [],
    hasDuctumLineage: true,
    hasExternalOutcome: false,
    externalOutcome: null,
    bakeoffOutcome: null,
    taskName: 'P1-BUILD',
    specName: 'milestone-a',
    projectName: 'qratum',
    agentName: 'codex',
    agentModel: 'gpt-5.5',
    retryCount: 0,
    ...overrides,
  }
}

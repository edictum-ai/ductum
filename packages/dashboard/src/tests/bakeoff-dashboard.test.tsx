import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BakeoffComparePanel } from '@/components/BakeoffComparePanel'
import { CreateBakeoffDialog } from '@/components/CreateBakeoffDialog'
import { agent, emptyDiff, run, spec, task } from './bakeoff-test-helpers'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

describe('Best-of-N dashboard', () => {
  afterEach(() => fetchHelper?.restore())

  it('creates a bakeoff with selected builders, reviewer, policy, prompt, and verify commands', async () => {
    const agents = [
      agent('builder-a', 'Builder A', 'gpt-5.5', 'builder'),
      agent('builder-b', 'Builder B', 'glm-5.2', 'builder'),
      agent('reviewer', 'Reviewer', 'claude-opus-4.8', 'reviewer'),
    ]
    const repositories = [{
      id: 'repo-api',
      projectId: 'p1',
      name: 'ductum',
      portable: false,
      spec: { localPath: '/Users/acartagena/project/ductum' },
      readiness: { supportsLocalWorkflow: true, supportsRemoteWorkflow: false },
      components: [{ id: 'component-api', repositoryId: 'repo-api', name: 'api', spec: { path: 'packages/api' }, createdAt: '', updatedAt: '' }],
    }]
    fetchHelper = mockFetch({
      'POST /api/projects/p1/bakeoffs': {
        spec: spec(),
        candidates: [],
        reviewTask: task('review', 'blind-review', 'reviewer'),
        dependencies: [],
        policy: 'quality-gated-cost-aware',
        strategyGroup: 'group-1',
        reviewer: agents[2],
        builders: agents.slice(0, 2),
        nextCommands: { watch: 'ductum task list s1', compare: 'ductum spec bakeoff compare s1' },
      },
    })
    const onCreated = vi.fn()
    renderWithProviders(
      <CreateBakeoffDialog
        projectId="p1"
        agents={agents}
        projectAgents={agents.map((item) => ({ projectId: 'p1', agentId: item.id, role: item.capabilities[0] ?? 'builder' }))}
        repositories={repositories}
        onCreated={onCreated}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /best-of-n/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Best patch' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Implement the patch' } })
    fireEvent.change(screen.getByLabelText('Policy / rubric'), { target: { value: 'cheapest-verified-reviewed' } })
    fireEvent.change(screen.getByLabelText('Scope'), { target: { value: 'component:repo-api:component-api' } })
    fireEvent.click(screen.getByLabelText(/Builder A/))
    fireEvent.click(screen.getByLabelText(/Builder B/))
    fireEvent.change(screen.getByLabelText('Reviewer'), { target: { value: 'reviewer' } })
    fireEvent.change(screen.getByLabelText('Verify commands'), { target: { value: 'pnpm test\npnpm lint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start bakeoff' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('Best patch'))
    const [call] = callsOf(fetchHelper, 'POST', '/api/projects/p1/bakeoffs')
    expect(requestBody(call!)).toMatchObject({
      name: 'Best patch',
      prompt: 'Implement the patch',
      builderAgentIds: ['builder-a', 'builder-b'],
      reviewerAgentId: 'reviewer',
      repositoryId: 'repo-api',
      componentId: 'component-api',
      policy: 'cheapest-verified-reviewed',
      verify: ['pnpm test', 'pnpm lint'],
    })
  })

  it('renders side-by-side candidate metrics and disabled unsupported actions', () => {
    const agents = [
      agent('builder-a', 'Builder A', 'gpt-5.5', 'builder'),
      agent('builder-b', 'Builder B', 'glm-5.2', 'builder'),
    ]
    fetchHelper = mockFetch({
      '/api/runs/run-a/diff': emptyDiff(),
      '/api/runs/run-b/diff': emptyDiff(),
    })
    const openRun = vi.fn()
    renderWithProviders(
      <BakeoffComparePanel
        spec={spec()}
        tasks={[
          { ...task('task-a', 'candidate-a', 'builder-a'), strategyRole: 'candidate', bakeoffOutcome: 'accepted' },
          { ...task('task-b', 'candidate-b', 'builder-b'), strategyRole: 'candidate', bakeoffOutcome: 'rejected' },
          { ...task('review', 'blind-review', 'reviewer'), strategyRole: 'blind_review', status: 'done' },
        ]}
        runs={[
          run('run-a', 'task-a', 'builder-a', 'Builder A', 'gpt-5.5', { costUsd: 1.5, tokensIn: 1000, tokensOut: 200, reviewStatus: 'pass' }),
          run('run-b', 'task-b', 'builder-b', 'Builder B', 'glm-5.2', { costUsd: 0.5, tokensIn: 800, tokensOut: 100, verifyRetries: 1 }),
        ]}
        agents={agents}
        onOpenTask={vi.fn()}
        onOpenRun={openRun}
      />,
    )

    expect(screen.getByText('Best-of-N compare')).toBeInTheDocument()
    expect(screen.getAllByText('candidate-a').length).toBeGreaterThan(0)
    expect(screen.getAllByText('candidate-b').length).toBeGreaterThan(0)
    expect(screen.getByText('Candidate diffs')).toBeInTheDocument()
    expect(screen.getByText('Winner')).toBeInTheDocument()
    expect(screen.getByText('accepted')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open winner' }))
    expect(openRun).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Rerun with another model' })).toBeDisabled()
  })

  it('renders API compare scores and reviewer confidence', () => {
    fetchHelper = mockFetch({ '/api/runs/run-a/diff': emptyDiff() })
    renderWithProviders(
      <BakeoffComparePanel
        spec={spec()}
        tasks={[{ ...task('task-a', 'candidate-a', 'builder-a'), strategyRole: 'candidate', bakeoffOutcome: 'accepted' }]}
        runs={[run('run-a', 'task-a', 'builder-a', 'Builder A', 'gpt-5.5', { costUsd: 1.5, tokensIn: 1000, tokensOut: 200, reviewStatus: 'pass' })]}
        agents={[agent('builder-a', 'Builder A', 'gpt-5.5', 'builder')]}
        compare={{
          spec: { id: 's1', projectId: 'p1', name: 'Best patch', status: 'approved' },
          policy: 'quality-gated-cost-aware',
          strategyGroup: 'group-1',
          status: 'complete',
          candidates: [{
            task: {
              taskId: 'task-a',
              taskName: 'candidate-a',
              taskStatus: 'done',
              runIds: ['run-a'],
              latestRunId: 'run-a',
              latestRunStage: 'ship',
              terminalState: null,
              blockedReason: null,
              failReason: null,
              pendingApproval: true,
              branch: 'ductum/candidate-a',
              commitSha: 'abc123',
              prUrl: null,
              worktreePaths: ['/tmp/candidate-a'],
            },
            agent: { id: 'builder-a', name: 'Builder A', model: 'gpt-5.5', modelLabel: 'GPT 5.5', provider: 'openai', harness: 'codex-sdk', effort: null, costTier: 10 },
            metrics: { tokensIn: 1000, tokensOut: 200, totalTokens: 1200, costUsd: 1.5, elapsedSeconds: 90, startedAt: null, updatedAt: null, attempts: 1, reviewPasses: 1, fixRounds: 0, verificationFailures: 0 },
            scores: { implementation: 10, review: 9, tests: 10, costEfficiency: 10, overall: 9.8, reviewerConfidence: 0.86 },
            outcome: 'accepted',
            verdictScore: { taskId: 'task-a', passed: true, confidence: 0.86, notes: 'cleanest patch' },
            winner: true,
            eligibility: { eligible: true, gates: { implementationCompleted: true, verifyPassed: true, reviewPassed: true, warnAccepted: false, safetyBlocked: false, artifactsAvailable: true }, blockingReasons: [] },
          }],
          reviewTask: null,
          verdict: { kind: 'best-of-n-verdict', winnerTaskId: 'task-a', scores: [{ taskId: 'task-a', passed: true, confidence: 0.86, notes: 'cleanest patch' }], policy: 'quality-gated-cost-aware', reason: 'cleanest patch' },
          winner: { taskId: 'task-a', runId: 'run-a', outcome: 'accepted', eligible: true },
          eligibility: { eligibleCount: 1, blockedCount: 0 },
          malformed: { reviewCount: 0, recoveryState: null },
          stats: {
            totals: { role: 'total', key: 'total', agentName: null, model: 'all', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 1.5, totalTokens: 1200, winner: true, humanOverride: false, failureCategory: null, judge: null },
            perModel: [{ role: 'builder', key: 'builder-a', agentName: 'Builder A', model: 'gpt-5.5', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 1.5, totalTokens: 1200, winner: true, humanOverride: false, failureCategory: null }],
            perJudge: [],
          } as never,
          nextActions: ['Review candidate task-a; approve through the normal Ductum approval flow if it should ship.'],
        }}
        onOpenTask={vi.fn()}
        onOpenRun={vi.fn()}
      />,
    )

    expect(screen.getByText('9.8/10')).toBeInTheDocument()
    expect(screen.getByText('86%')).toBeInTheDocument()
    expect(screen.getByText('cleanest patch')).toBeInTheDocument()
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument()
    expect(screen.getByText(/Truthful stats/)).toBeInTheDocument()
  })

  it('rejects duplicate builder model and harness combinations client-side', () => {
    const agents = [
      agent('builder-a', 'Builder A', 'gpt-5.5', 'builder'),
      agent('builder-b', 'Builder B', 'gpt-5.5', 'builder'),
      agent('reviewer', 'Reviewer', 'claude-opus-4.8', 'reviewer'),
    ]
    fetchHelper = mockFetch({ 'POST /api/projects/p1/bakeoffs': {} })
    renderWithProviders(
      <CreateBakeoffDialog
        projectId="p1"
        agents={agents}
        projectAgents={agents.map((item) => ({ projectId: 'p1', agentId: item.id, role: item.capabilities[0] ?? 'builder' }))}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /best-of-n/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Best patch' } })
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Implement the patch' } })
    fireEvent.click(screen.getByLabelText(/Builder A/))
    fireEvent.click(screen.getByLabelText(/Builder B/))
    expect(screen.getByText(/combinations must be unique/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start bakeoff' })).toBeDisabled()
  })
})

import type { Agent, BakeoffCompareResponse, EnrichedRun, Spec, Task } from '@/api/client'
import { BakeoffCandidateCard } from '@/components/BakeoffCandidateCard'
import { BakeoffCandidateDiffGrid } from '@/components/BakeoffCandidateDiffGrid'
import { Btn, Card, CardHeader, Mono, tokens } from '@/components/signal'
import { isCostUnknown, runCost, runStatusLabel } from '@/lib/run-presentation'

export type BakeoffCompareCandidateView = {
  task?: Task
  taskId: string
  taskName: string
  status: string
  agentName: string
  agentModel: string
  agentProvider: string | null
  runs: EnrichedRun[]
  latest?: EnrichedRun
  latestRunId: string | null
  outcome: string | null
  winner: boolean
  tokensTotal: number
  costUsd: number
  costUnmeasured: boolean
  elapsedSeconds: number | null
  verifyFailures: number
  verifyPassed: boolean | null
  reviewPasses: number
  fixRounds: number
  branch: string | null
  commitSha: string | null
  prUrl: string | null
  worktreePaths: string[] | null
  scores: { implementation: number; review: number; tests: number; costEfficiency: number; overall: number; reviewerConfidence: number | null } | null
  eligible: boolean | null
  blockers: string[]
  notes: string | null
}

export function BakeoffComparePanel({
  spec,
  tasks,
  runs,
  agents,
  compare,
  onOpenTask,
  onOpenRun,
}: {
  spec: Spec
  tasks: Task[]
  runs: EnrichedRun[]
  agents: Agent[]
  compare?: BakeoffCompareResponse | null
  onOpenTask: (task: Task) => void
  onOpenRun: (task: Task, run: EnrichedRun) => void
}) {
  const candidates = compare == null
    ? buildCandidates(tasks, runs, agents)
    : buildCompareCandidates(compare, tasks, runs)
  const fallbackReviewTask = tasks.find((task) => task.strategyRole === 'blind_review')
  const reviewTaskName = compare?.reviewTask?.taskName ?? fallbackReviewTask?.name
  const reviewTaskStatus = compare?.reviewTask?.taskStatus ?? fallbackReviewTask?.status
  const winner = candidates.find((candidate) => candidate.winner) ?? candidates.find((candidate) => isWinningOutcome(candidate.outcome))
  const firstLoser = candidates.find((candidate) => candidate.taskId !== winner?.taskId)
  const policy = compare?.policy ?? (spec.strategyConfig?.kind === 'best_of_n' ? spec.strategyConfig.policy : 'unknown')
  const verifyCommands = spec.strategyConfig?.kind === 'best_of_n' ? spec.strategyConfig.verify : []

  if (candidates.length === 0) return null

  const openWinner = winner?.task != null && winner.latest != null
    ? () => onOpenRun(winner.task as Task, winner.latest as EnrichedRun)
    : undefined

  return (
    <Card>
      <CardHeader
        title="Best-of-N compare"
        meta={`${candidates.length} candidates · ${compare?.status ?? 'local'} · policy ${policy}`}
        tone={tokens.accent}
        action={<Mono size={11} color={winner ? tokens.ok : tokens.dim}>{winner ? `winner ${winner.taskName}` : 'winner pending'}</Mono>}
      />
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn disabled={openWinner == null} onClick={openWinner}>Open winner</Btn>
          <Btn danger disabled title="Reject-all API is not available yet">Reject all</Btn>
          <Btn disabled title="Rerun API is not available yet">Rerun with another model</Btn>
          <Btn disabled={firstLoser?.task == null} onClick={() => firstLoser?.task && onOpenTask(firstLoser.task)}>Inspect loser</Btn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {sortCandidates(candidates).map((candidate, index) => (
            <BakeoffCandidateCard
              key={candidate.taskId}
              candidate={candidate}
              label={`Candidate ${index + 1}`}
              onOpenTask={candidate.task == null ? undefined : () => onOpenTask(candidate.task as Task)}
              onOpenRun={candidate.task == null || candidate.latest == null ? undefined : () => onOpenRun(candidate.task as Task, candidate.latest as EnrichedRun)}
            />
          ))}
        </div>
        <BakeoffCandidateDiffGrid candidates={sortCandidates(candidates)} />
        <ReviewSummary taskName={reviewTaskName} status={reviewTaskStatus} verdict={compare?.verdict?.reason ?? null} />
        <CommandPanel spec={spec} verifyCommands={verifyCommands} winner={winner} nextActions={compare?.nextActions ?? []} />
      </div>
    </Card>
  )
}

function buildCompareCandidates(compare: BakeoffCompareResponse, tasks: Task[], runs: EnrichedRun[]): BakeoffCompareCandidateView[] {
  return compare.candidates.map((candidate) => {
    const task = tasks.find((item) => item.id === candidate.task.taskId)
    const taskRuns = runs.filter((run) => candidate.task.runIds.includes(run.id))
    const latest = taskRuns.find((run) => run.id === candidate.task.latestRunId) ?? taskRuns[0]
    return {
      task,
      taskId: candidate.task.taskId,
      taskName: candidate.task.taskName,
      status: statusLabel(candidate.task.latestRunStage, candidate.task.taskStatus, candidate.task.pendingApproval),
      agentName: candidate.agent?.name ?? latest?.agentName ?? 'Unassigned',
      agentModel: candidate.agent?.model ?? latest?.agentModel ?? 'model unknown',
      agentProvider: candidate.agent?.provider ?? null,
      runs: taskRuns,
      latest,
      latestRunId: candidate.task.latestRunId,
      outcome: candidate.outcome,
      winner: candidate.winner,
      tokensTotal: candidate.metrics.totalTokens,
      costUsd: candidate.metrics.costUsd,
      costUnmeasured: candidate.metrics.costUsd === 0 && taskRuns.some((run) => isCostUnknown(runCost(run).state)),
      elapsedSeconds: candidate.metrics.elapsedSeconds,
      verifyFailures: candidate.metrics.verificationFailures,
      verifyPassed: candidate.eligibility.gates.verifyPassed,
      reviewPasses: candidate.metrics.reviewPasses,
      fixRounds: candidate.metrics.fixRounds,
      branch: candidate.task.branch,
      commitSha: candidate.task.commitSha,
      prUrl: candidate.task.prUrl,
      worktreePaths: candidate.task.worktreePaths,
      scores: candidate.scores,
      eligible: candidate.eligibility.eligible,
      blockers: candidate.eligibility.blockingReasons,
      notes: candidate.verdictScore?.notes ?? null,
    }
  })
}

function buildCandidates(tasks: Task[], runs: EnrichedRun[], agents: Agent[]): BakeoffCompareCandidateView[] {
  return tasks
    .filter((task) => task.strategyRole === 'candidate')
    .map((task) => {
      const taskRuns = runs.filter((run) => run.taskId === task.id).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      const latest = taskRuns[0]
      const tokensTotal = taskRuns.reduce((sum, run) => sum + run.tokensIn + run.tokensOut, 0)
      const cost = totalCost(taskRuns)
      const outcome = task.bakeoffOutcome ?? latest?.bakeoffOutcome ?? null
      return {
        task,
        taskId: task.id,
        taskName: task.name,
        status: latest ? runStatusLabel(latest) : task.status,
        agentName: agents.find((agent) => agent.id === (task.assignedAgentId ?? latest?.agentId))?.name ?? latest?.agentName ?? 'Unassigned',
        agentModel: agents.find((agent) => agent.id === (task.assignedAgentId ?? latest?.agentId))?.model ?? latest?.agentModel ?? 'model unknown',
        agentProvider: null,
        runs: taskRuns,
        latest,
        latestRunId: latest?.id ?? null,
        outcome,
        winner: isWinningOutcome(outcome),
        tokensTotal,
        costUsd: cost,
        costUnmeasured: cost === 0 && taskRuns.some((run) => isCostUnknown(runCost(run).state)),
        elapsedSeconds: latest == null ? null : Math.max(0, Math.round((Date.parse(latest.updatedAt) - Date.parse(latest.createdAt)) / 1000)),
        verifyFailures: taskRuns.reduce((sum, run) => sum + (run.verifyRetries ?? 0), 0),
        verifyPassed: null,
        reviewPasses: taskRuns.filter((run) => run.reviewStatus === 'pass').length,
        fixRounds: taskRuns.reduce((sum, run) => sum + run.resetCount, 0),
        branch: latest?.branch ?? null,
        commitSha: latest?.commitSha ?? null,
        prUrl: latest?.prUrl ?? null,
        worktreePaths: latest?.worktreePaths ?? null,
        scores: null,
        eligible: null,
        blockers: [],
        notes: null,
      }
    })
}

function sortCandidates(candidates: BakeoffCompareCandidateView[]) {
  return [...candidates].sort((left, right) => {
    const winnerDelta = Number(right.winner) - Number(left.winner)
    if (winnerDelta !== 0) return winnerDelta
    const eligibleDelta = Number(right.eligible === true) - Number(left.eligible === true)
    if (eligibleDelta !== 0) return eligibleDelta
    const scoreDelta = (right.scores?.overall ?? -1) - (left.scores?.overall ?? -1)
    if (scoreDelta !== 0) return scoreDelta
    return left.costUsd - right.costUsd
  })
}

function ReviewSummary({ taskName, status, verdict }: { taskName?: string; status?: string; verdict: string | null }) {
  return (
    <section style={{ borderTop: `1px solid ${tokens.hair}`, paddingTop: 12 }}>
      <Mono size={11} color={tokens.dim}>Reviewer verdict</Mono>
      <div style={{ marginTop: 6, color: tokens.fg, fontSize: 13 }}>
        {taskName == null ? 'No blind-review task is visible yet.' : `${taskName} is ${status ?? 'pending'}. ${verdict ?? 'Verdict pending.'}`}
      </div>
    </section>
  )
}

function CommandPanel({ spec, verifyCommands, winner, nextActions }: { spec: Spec; verifyCommands: string[]; winner: BakeoffCompareCandidateView | undefined; nextActions: string[] }) {
  return (
    <section style={{ borderTop: `1px solid ${tokens.hair}`, paddingTop: 12, display: 'grid', gap: 6 }}>
      <Mono size={11} color={tokens.dim}>Next commands</Mono>
      <Mono size={11} color={tokens.fg}>ductum spec bakeoff compare {spec.id}</Mono>
      {winner?.latestRunId != null && <Mono size={11} color={tokens.fg}>ductum approve {winner.latestRunId}</Mono>}
      {nextActions.map((action) => <Mono key={action} size={11} color={tokens.mid}>{action}</Mono>)}
      {verifyCommands.length > 0 && <Mono size={11} color={tokens.faint}>verify: {verifyCommands.join(' && ')}</Mono>}
    </section>
  )
}

function statusLabel(stage: string | null, taskStatus: string, pendingApproval: boolean) {
  if (stage === 'ship' && pendingApproval) return 'Awaiting approval'
  return stage ?? taskStatus
}

function totalCost(runs: EnrichedRun[]) {
  return runs.reduce((sum, run) => sum + runCost(run).usd, 0)
}

function isWinningOutcome(outcome: string | null) {
  return outcome === 'accepted' || outcome === 'accepted-with-fixes'
}

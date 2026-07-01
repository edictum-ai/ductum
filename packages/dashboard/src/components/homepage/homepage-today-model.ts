import type { EnrichedRun, ExecutionMode, FactoryActivitySummary } from '@/api/client'
import { costCoverageIssues, summarizeCostCoverage } from '@/lib/cost-coverage'
import { hasExecutionIntegrityIssue } from '@/lib/execution-integrity'
import type { OperatorProgressSnapshot } from '@/lib/operator-progress'
import { runCost, runDisplayStatus } from '@/lib/run-presentation'
import { tokens } from '@/components/signal'
import { formatCost, timeAgo } from '@/lib/utils'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function buildHomeHealth(runs: EnrichedRun[]) {
  const coverage = summarizeCostCoverage(runs)
  const totalUsd = coverage.trackedUsd
  const costGaps = coverage.missingUsage + coverage.missingPrice
  const cleanDone = runs.filter((run) => runDisplayStatus(run) === 'done' && !hasExecutionIntegrityIssue(run)).length
  const total = runs.length
  const costPerCleanDoneUsd = cleanDone > 0 ? totalUsd / cleanDone : null
  const cutoff = Date.now() - WEEK_MS
  const stalledThisWeek = runs.filter((run) => {
    const status = runDisplayStatus(run)
    const happenedThisWeek = activityTime(run) >= cutoff
    return happenedThisWeek && (status === 'failed' || status === 'stalled')
  }).length

  return {
    cleanDone,
    total,
    weekCost: weeklyCost(runs),
    unmeasured: costGaps,
    costPerCleanDoneUsd,
    stalledThisWeek,
    cleanDoneRateLabel: total === 0 ? '0/0' : `${cleanDone}/${total}`,
    cleanDoneRateDetail: total === 0 ? 'no attempts yet' : `${Math.round((cleanDone / total) * 100)}% done without integrity issues`,
    costPerCleanDoneLabel: costPerCleanDoneUsd == null ? 'n/a' : formatCost(costPerCleanDoneUsd),
    costDetail: totalUsd > 0 ? `${formatCost(totalUsd)} tracked` : 'no tracked spend',
    caveatValue: costGaps === 0 ? 'clear' : `${costGaps}/${total}`,
    caveatDetail: costGaps === 0 ? 'all attempt costs tracked' : costCoverageIssues(coverage),
  }
}

export function buildHomeHealthFromSummary(summary: FactoryActivitySummary) {
  const total = summary.allTime.attemptCount
  const cleanDone = summary.allTime.cleanDone
  const costGaps = summary.allTime.cost.missingUsage + summary.allTime.cost.missingPrice
  return {
    cleanDone,
    total,
    weekCost: summary.currentWindow.cost.trackedUsd,
    unmeasured: costGaps,
    costPerCleanDoneUsd: summary.allTime.costPerCleanDoneUsd,
    stalledThisWeek: summary.currentWindow.stalledOrFailed,
    cleanDoneRateLabel: total === 0 ? '0/0' : `${cleanDone}/${total}`,
    cleanDoneRateDetail: total === 0 ? 'no attempts yet' : `${Math.round((cleanDone / total) * 100)}% done without integrity issues`,
    costPerCleanDoneLabel: summary.allTime.costPerCleanDoneLabel,
    costDetail: summary.allTime.cost.trackedUsd > 0
      ? `${formatCost(summary.allTime.cost.trackedUsd)} tracked · ${summary.source.label}`
      : `no tracked spend · ${summary.source.label}`,
    caveatValue: costGaps === 0 ? 'clear' : `${costGaps}/${total}`,
    caveatDetail: costGaps === 0 ? 'all attempt costs tracked' : summary.allTime.cost.issueLabel,
  }
}

export function buildHomeVerdict(snapshot: OperatorProgressSnapshot, weekCost: number) {
  const state = snapshot.needsOperator > 0
    ? 'Factory needs you'
    : snapshot.activeRuns > 0
      ? 'Factory running'
      : snapshot.approvalsWaiting > 0
        ? 'Factory waiting on approval'
        : snapshot.readyTasks > 0
          ? 'Factory ready to dispatch'
          : 'Factory idle'
  const done = snapshot.taskTotal === 0 ? 'no tasks yet' : `${snapshot.taskCounts.done}/${snapshot.taskTotal} tasks done`
  const action = snapshot.needsOperator > 0
    ? `${snapshot.needsOperator} needs you`
    : snapshot.approvalsWaiting > 0
      ? `${snapshot.approvalsWaiting} awaiting approval`
      : snapshot.readyTasks > 0
        ? `${snapshot.readyTasks} ready`
        : 'nothing waiting'
  const color = snapshot.needsOperator > 0
    ? tokens.err
    : snapshot.approvalsWaiting > 0 || snapshot.readyTasks > 0
      ? tokens.accent
      : snapshot.activeRuns > 0
        ? tokens.info
        : tokens.ok
  return { text: `${state} · ${done} · ${action} · ${formatCost(weekCost)}/wk`, color }
}

export function buildSinceLastLook(runs: EnrichedRun[], lastSeenAt: string | null): string {
  if (lastSeenAt == null) return 'Since you last looked: tracking starts now.'
  const since = Date.parse(lastSeenAt)
  if (!Number.isFinite(since)) return 'Since you last looked: tracking starts now.'
  const recent = runs.filter((run) => activityTime(run) > since)
  if (recent.length === 0) return `Since you last looked (${timeAgo(lastSeenAt)}): no new attempt activity.`
  const newAttempts = recent.filter((run) => Date.parse(run.createdAt) > since).length
  const finished = recent.filter((run) => runDisplayStatus(run) === 'done').length
  const attention = recent.filter((run) => {
    const status = runDisplayStatus(run)
    return status === 'failed' || status === 'stalled' || hasExecutionIntegrityIssue(run)
  }).length
  const coverage = summarizeCostCoverage(recent)
  const costUsd = coverage.trackedUsd
  const costIssues = costCoverageIssues(coverage)
  const parts = [
    newAttempts > 0 ? `+${newAttempts} attempt${newAttempts === 1 ? '' : 's'}` : null,
    finished > 0 ? `${finished} finished` : null,
    attention > 0 ? `${attention} action item${attention === 1 ? '' : 's'}` : null,
    costUsd > 0 ? `+${formatCost(costUsd)}` : null,
    costIssues || null,
  ].filter(Boolean)
  if (parts.length === 0) return `Since you last looked (${timeAgo(lastSeenAt)}): attempt activity changed.`
  return `Since you last looked (${timeAgo(lastSeenAt)}): ${parts.join(' · ')}.`
}

export function homeWorkStateSummary(snapshot: OperatorProgressSnapshot): string {
  const blockedFailed = snapshot.taskCounts.blocked + snapshot.taskCounts.failed
  return `${snapshot.taskCounts.done} done · ${blockedFailed} blocked/failed history · ${snapshot.activeRuns} active now · ${snapshot.readyTasks} ready`
}

export function homeProvenanceSummary(snapshot: OperatorProgressSnapshot): string {
  const ductumTasks = snapshot.taskModes.orchestrated ?? 0
  const ductumRuns = snapshot.runModes.orchestrated ?? 0
  const recordedTasks = snapshot.taskModes.recorded ?? 0
  const recordedRuns = snapshot.runModes.recorded ?? 0
  return `Ductum ${ductumTasks} tasks/${ductumRuns} runs · recorded ${recordedTasks}/${recordedRuns} · external ${snapshot.externalCount}`
}

export function homeIntegritySummary(snapshot: OperatorProgressSnapshot): string {
  if (snapshot.integrityIssues === 0) return 'clear'
  return `${snapshot.integrityIssues} contradiction${snapshot.integrityIssues === 1 ? '' : 's'}`
}

export function homeModeColor(mode: ExecutionMode): string {
  switch (mode) {
    case 'orchestrated': return tokens.ok
    case 'external': return tokens.info
    case 'recorded': return tokens.warn
    case 'inconsistent': return tokens.err
    default: return tokens.mid
  }
}

function weeklyCost(runs: EnrichedRun[]): number {
  const cutoff = Date.now() - WEEK_MS
  return runs
    .filter((run) => Date.parse(run.createdAt) >= cutoff)
    .reduce((sum, run) => sum + runCost(run).usd, 0)
}

function activityTime(run: EnrichedRun): number {
  return Date.parse(run.lastHeartbeat ?? run.updatedAt)
}

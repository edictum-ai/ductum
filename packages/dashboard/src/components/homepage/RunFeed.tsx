import { Activity, AlertTriangle, CheckCircle2, Clock, DollarSign } from 'lucide-react'
import type { ElementType } from 'react'
import { Link } from 'react-router-dom'

import type { EnrichedAttempt, EnrichedRun, ExecutionMode, FactoryActivitySummary } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  DISPLAY_STATUS_CLASSES,
  countByDisplayStatus,
  type DisplayStatus,
} from '@/lib/derived-status'
import { costCoverageIssues, costCoverageValue, hasCostGap, summarizeCostCoverage } from '@/lib/cost-coverage'
import { displayRunTaskName, displayStoredName } from '@/lib/project-display'
import { runCost, runDisplayStatus, runHref, runNeedsAttention, runStatusLabel } from '@/lib/run-presentation'
import { isSupersededProblemRun, latestRunByLineage, runLineageKey } from '@/lib/run-lineage'
import { stageLabel, stageTone } from '@/lib/stage-display'
import { toneBadgeClass } from '@/components/signal'
import { cn, timeAgo } from '@/lib/utils'
import { executionModeBadgeLabel, hasExecutionIntegrityIssue } from '@/lib/execution-integrity'

export type AttemptFeedRow = EnrichedRun | EnrichedAttempt

function lastActivityAt(run: AttemptFeedRow): string {
  return run.lastHeartbeat ?? run.updatedAt
}

function sortByLastActivityDesc(a: AttemptFeedRow, b: AttemptFeedRow): number {
  return new Date(lastActivityAt(b)).getTime() - new Date(lastActivityAt(a)).getTime()
}

function toOrdinal(value: number): string {
  const mod100 = value % 100
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`
  switch (value % 10) {
    case 1: return `${value}st`
    case 2: return `${value}nd`
    case 3: return `${value}rd`
    default: return `${value}th`
  }
}

function attemptLabel(retryCount: number): string | null {
  if (retryCount <= 0) return null
  return `${toOrdinal(retryCount + 1)} attempt`
}

const EXECUTION_MODE_CLASSES: Record<ExecutionMode, string> = {
  orchestrated: 'border-emerald-500/40 text-emerald-300',
  external: 'border-sky-500/40 text-sky-300',
  recorded: 'border-amber-500/40 text-amber-300',
  unknown: 'border-border/50 text-muted-foreground',
  inconsistent: 'border-red-500/50 text-red-300',
}

function urgencyRank(status: DisplayStatus): number {
  if (status === 'stalled') return 0
  if (status === 'failed') return 1
  if (status === 'cancelled') return 3
  return 2
}

interface SummaryCardProps {
  icon: ElementType
  label: string
  value: string | number
  sub?: string
  variant?: 'default' | 'danger' | 'warn' | 'success'
}

function SummaryCard({ icon: Icon, label, value, sub, variant = 'default' }: SummaryCardProps) {
  const iconClass =
    variant === 'danger' ? 'text-red-400'
    : variant === 'warn' ? 'text-amber-400'
    : variant === 'success' ? 'text-emerald-400'
    : 'text-primary'
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-sm">
      <CardContent className="flex items-start gap-3 p-4">
        <div className={cn('mt-0.5 rounded-md bg-muted p-2', iconClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="font-mono text-2xl font-bold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {sub && <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function SummaryBar({ runs, attentionCountOverride, summary }: { runs: AttemptFeedRow[]; attentionCountOverride?: number; summary?: FactoryActivitySummary }) {
  const counts = countByDisplayStatus(runs)
  const latestByLineage = latestRunByLineage(runs)
  const aggregate = summary?.allTime
  const attentionCount = attentionCountOverride ?? runs.filter((run) =>
    !isSupersededProblemRun(run, latestByLineage.get(runLineageKey(run))) &&
      (hasExecutionIntegrityIssue(run) || runNeedsAttention(run)),
  ).length
  const cleanDoneCount = aggregate?.cleanDone ?? runs.filter((run) => runDisplayStatus(run) === 'done' && !hasExecutionIntegrityIssue(run)).length
  const costCoverage = summarizeCostCoverage(runs)
  const totalTokensOut = aggregate?.tokensOut ?? runs.reduce((sum, r) => sum + r.tokensOut, 0)
  const costIssues = aggregate?.cost.issueLabel ?? costCoverageIssues(costCoverage)
  const costSub = [
    totalTokensOut > 0 ? `${(totalTokensOut / 1000).toFixed(0)}k output tokens` : null,
    costIssues || null,
  ].filter(Boolean).join(' · ') || undefined
  const displayedCounts = aggregate?.statusCounts ?? counts
  const totalAttempts = aggregate?.attemptCount ?? runs.length
  const costHasGap = aggregate?.cost.hasGap ?? hasCostGap(costCoverage)
  const costValue = aggregate?.cost.valueLabel ?? costCoverageValue(costCoverage)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      <SummaryCard label="Running" value={displayedCounts.running} icon={Activity} />
      <SummaryCard
        label="Awaiting approval"
        value={displayedCounts.awaiting_approval}
        icon={Clock}
        variant={displayedCounts.awaiting_approval > 0 ? 'warn' : 'default'}
      />
      <SummaryCard
        label="Action needed"
        value={attentionCount}
        icon={AlertTriangle}
        variant={attentionCount > 0 ? 'danger' : 'default'}
      />
      <SummaryCard
        label="Completed"
        value={cleanDoneCount}
        sub={`of ${totalAttempts} attempts`}
        icon={CheckCircle2}
        variant="success"
      />
      <SummaryCard
        label={costHasGap ? 'Tracked cost' : 'Total cost'}
        value={costValue}
        sub={costSub}
        icon={DollarSign}
      />
    </div>
  )
}

function stageBadgeFor(run: AttemptFeedRow): { label: string; classes: string } {
  if (run.terminalState === 'failed') {
    return { label: 'Failed', classes: toneBadgeClass(stageTone('failed')) }
  }
  if (run.terminalState === 'stalled') {
    return { label: 'Stalled', classes: toneBadgeClass(stageTone('stalled')) }
  }
  return {
    label: stageLabel(run.stage),
    classes: toneBadgeClass(stageTone(run.stage)),
  }
}

function executionBadgeFor(run: AttemptFeedRow): { label: string; classes: string } | null {
  const mode = run.executionMode
  if (mode == null) return null
  return {
    label: executionModeBadgeLabel(run) ?? mode,
    classes: EXECUTION_MODE_CLASSES[mode],
  }
}

export function RunRow({ run }: { run: AttemptFeedRow }) {
  const status = runDisplayStatus(run)
  const stage = stageBadgeFor(run)
  const execution = executionBadgeFor(run)
  const failureReason =
    status === 'failed' || status === 'stalled' ? run.failReason ?? run.blockedReason : null
  const retry = attemptLabel(run.retryCount)
  const url = runHref(run)
  const taskLabel = displayRunTaskName(run)
  const specLabel = displayStoredName(run.specName, 'Spec')

  return (
    <Link
      to={url}
      className={cn(
        'flex w-full items-start gap-4 rounded-lg border border-transparent px-4 py-3 text-left transition-all',
        'hover:border-border/40 hover:bg-accent/50',
        (status === 'failed' || status === 'stalled') && 'bg-red-950/10',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('border font-mono text-[10px]', DISPLAY_STATUS_CLASSES[status])}>
            {runStatusLabel(run)}
          </Badge>
          <span className="truncate text-sm font-semibold tracking-tight">{taskLabel}</span>
          {retry && (
            <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
              {retry}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate">
            {run.projectName} &gt; {specLabel}
          </span>
          <span className="truncate font-medium text-foreground/85">{run.agentName}</span>
          {run.agentModel && (
            <Badge variant="outline" className="border-border/50 font-mono text-[10px] text-muted-foreground">
              {run.agentModel}
            </Badge>
          )}
          <Badge variant="outline" className={cn('border font-mono text-[10px]', stage.classes)}>
            {stage.label}
          </Badge>
          {execution && (
            <Badge variant="outline" className={cn('border font-mono text-[10px]', execution.classes)}>
              {execution.label}
            </Badge>
          )}
        </div>

        {failureReason && <p className="mt-2 truncate text-xs text-red-400">{failureReason}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
        <div>
          <p className="font-mono text-[11px]">{timeAgo(lastActivityAt(run))}</p>
          <p className="text-[10px] text-muted-foreground/70">last activity</p>
        </div>
        <div>
          <p className="font-mono text-[11px]">{runCost(run).label}</p>
          <p className="text-[10px] text-muted-foreground/70">cost</p>
        </div>
      </div>
    </Link>
  )
}

export function RunSection({
  title,
  runs,
  variant = 'default',
}: {
  title: string
  runs: AttemptFeedRow[]
  variant?: 'default' | 'danger' | 'warn'
}) {
  if (runs.length === 0) return null
  return (
    <div>
      <h3
        className={cn(
          'mb-2 flex items-center gap-1.5 px-1 font-mono text-[10px] font-semibold uppercase tracking-widest',
          variant === 'danger' ? 'text-red-400'
          : variant === 'warn' ? 'text-amber-400'
          : 'text-muted-foreground/70',
        )}
      >
        {variant === 'danger' && <AlertTriangle className="h-3 w-3" />}
        {variant === 'warn' && <Clock className="h-3 w-3" />}
        {title}
        <span className="text-muted-foreground/50">({runs.length})</span>
      </h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    </div>
  )
}

/**
 * Bucket enriched runs into the five display-status sections.
 * Each bucket is sorted by most-recent activity within itself; the
 * Action-needed bucket additionally surfaces stalled before failed.
 */
export function buildRunSections<T extends AttemptFeedRow>(runs: T[] | undefined): {
  running: T[]
  awaitingApproval: T[]
  needsAttention: T[]
  recentDone: T[]
} {
  const running: T[] = []
  const awaitingApproval: T[] = []
  const needsAttention: T[] = []
  const completed: T[] = []
  const latestByLineage = latestRunByLineage(runs ?? [])

  for (const run of runs ?? []) {
    const status = runDisplayStatus(run)
    if (isSupersededProblemRun(run, latestByLineage.get(runLineageKey(run)))) continue
    if (hasExecutionIntegrityIssue(run)) needsAttention.push(run)
    else if (status === 'running') running.push(run)
    else if (status === 'awaiting_approval') awaitingApproval.push(run)
    else if (runNeedsAttention(run)) needsAttention.push(run)
    else if (status === 'done') completed.push(run)
  }

  running.sort(sortByLastActivityDesc)
  awaitingApproval.sort(sortByLastActivityDesc)
  needsAttention.sort((a, b) => {
    const byUrgency = urgencyRank(runDisplayStatus(a)) - urgencyRank(runDisplayStatus(b))
    return byUrgency !== 0 ? byUrgency : sortByLastActivityDesc(a, b)
  })
  completed.sort(sortByLastActivityDesc)

  return {
    running,
    awaitingApproval,
    needsAttention,
    recentDone: completed.slice(0, 10),
  }
}

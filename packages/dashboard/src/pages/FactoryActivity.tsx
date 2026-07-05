import { Activity, CheckCircle2, Clock } from 'lucide-react'
import type { ElementType, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { EnrichedAttempt, EnrichedRun } from '@/api/client'
import { useAllAttempts, useFactoryActivitySummary, useOperatorBrief } from '@/api/hooks'
import { NeedsOperatorSection } from '@/components/activity/NeedsOperatorSection'
import { ReadyDispatchSection } from '@/components/activity/ReadyDispatchSection'
import { MetricPill, Page, PageHeader } from '@/components/signal'
import { SummaryBar, buildRunSections } from '@/components/homepage/RunFeed'
import { Badge } from '@/components/ui/badge'
import { executionModeBadgeLabel } from '@/lib/execution-integrity'
import { readableCostLabel } from '@/lib/cost-coverage'
import { displayRunTaskName, displayStoredName } from '@/lib/project-display'
import { runCost, runDisplayStatus, runHref, runStatusLabel } from '@/lib/run-presentation'
import { cn, timeAgo } from '@/lib/utils'

const SECTION_LIMIT = 8
type ActivityAttempt = EnrichedRun | EnrichedAttempt

export function FactoryActivity() {
  const { data: attemptsData, isLoading } = useAllAttempts({ limit: '500' })
  const { data: brief } = useOperatorBrief()
  const { data: activitySummary } = useFactoryActivitySummary()
  const attempts = (attemptsData as EnrichedAttempt[] | undefined) ?? []
  const sections = buildRunSections(attempts)
  const briefNeedsOperatorCount = brief?.queue.needsOperator
  const currentNeedsOperator = brief?.queue.needsOperatorAttempts ?? []
  const needsOperatorCount = briefNeedsOperatorCount ?? currentNeedsOperator.length
  const hasNeedsOperator = needsOperatorCount > 0 || currentNeedsOperator.length > 0
  const readyTaskCount = brief?.queue.readyTasks ?? 0

  // Issue #244 data truth: every headline metric pill must disclose
  // whether its value comes from the uncapped factory summary / operator
  // brief (authoritative) or from the latest 500 fetched attempts
  // (capped fallback). Pills that fall back to list-derived counts
  // without an explicit title silently invite operators to read a
  // windowed number as a factory total.
  const summaryAllTime = activitySummary?.allTime
  const summarySourceLabel = activitySummary?.source.label
  const fetchedWindowTitle = 'Derived from the latest 500 fetched attempts.'
  const aggregateTitle = summarySourceLabel ?? fetchedWindowTitle
  const runningTitle = summaryAllTime != null ? aggregateTitle : fetchedWindowTitle
  const approvalTitle = summaryAllTime != null ? aggregateTitle : fetchedWindowTitle
  const actionNeededTitle = briefNeedsOperatorCount != null
    ? 'Failed or stalled attempts needing operator action (operator brief).'
    : fetchedWindowTitle

  if (isLoading) {
    return (
      <Page maxWidth={1280}>
        <div className="shimmer" style={{ height: 140, borderRadius: 10, marginBottom: 24 }} />
        <div className="shimmer" style={{ height: 360, borderRadius: 10 }} />
      </Page>
    )
  }

  return (
    <Page maxWidth={1280}>
      <PageHeader
	        eyebrow="Factory Activity"
	        title="Factory Activity"
	        icon={<Activity className="h-4 w-4" />}
	        subtitle="Live attempts, approval waits, failed or stalled runs, and recent completions. Totals use the uncapped factory summary."
        metrics={(
          <>
            <MetricPill label="total attempts" value={activitySummary?.allTime.attemptCount ?? attempts.length} title={aggregateTitle} />
            <MetricPill label="running" value={activitySummary?.allTime.statusCounts.running ?? sections.running.length} tone="info" title={runningTitle} />
            <MetricPill label="approval" value={activitySummary?.allTime.statusCounts.awaiting_approval ?? sections.awaitingApproval.length} tone="accent" title={approvalTitle} />
            <MetricPill label="action needed" value={needsOperatorCount} tone="err" title={actionNeededTitle} />
            <MetricPill label="ready" value={readyTaskCount} tone={readyTaskCount > 0 ? 'accent' : 'default'} />
          </>
        )}
      />
      <div style={{ display: 'grid', gap: 20 }}>
        {hasNeedsOperator && (
          <NeedsOperatorSection
            attempts={currentNeedsOperator}
            reportedCount={briefNeedsOperatorCount}
          />
        )}
        <ReadyDispatchSection
          attempts={attempts}
          reportedCount={readyTaskCount}
          readyTaskIds={brief?.queue.readyTaskIds}
        />
        {!hasNeedsOperator && <AttentionClearLine reportedCount={briefNeedsOperatorCount} />}
        <SummaryBar runs={attempts} attentionCountOverride={needsOperatorCount} summary={activitySummary} />
        <div className="grid gap-4 xl:grid-cols-2">
          <ActivitySection
            title="Running attempts"
            attempts={sections.running}
            icon={Activity}
            emptyText="All clear · no attempts are running."
          />
          <ActivitySection
            title="Awaiting approval"
            attempts={sections.awaitingApproval}
            icon={Clock}
            tone="warn"
            emptyText="All clear · no attempts are awaiting approval."
            action={<Link className="text-[11px] text-primary hover:underline" to="/approvals">Open approvals</Link>}
          />
          <ActivitySection
            title="Recent completed attempts"
            attempts={sections.recentDone}
            icon={CheckCircle2}
            tone="success"
            emptyText="No completed attempts in the fetched window."
          />
        </div>
      </div>
    </Page>
  )
}

function AttentionClearLine({ reportedCount }: { reportedCount?: number }) {
  return (
    <section className="rounded-lg border border-border/40 bg-card/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-emerald-300">
	          Action clear
        </h2>
        <Badge variant="outline" className="ml-1 border-border/50 font-mono text-[10px] text-muted-foreground">
          0
        </Badge>
        <p className="ml-auto text-xs text-muted-foreground">
          {reportedCount == null
            ? 'No operator brief rows currently require action.'
	            : 'Operator brief shows 0 failed or stalled action items.'}
        </p>
      </div>
    </section>
  )
}

function ActivitySection({
  title,
  attempts,
  icon: Icon,
  tone = 'default',
  emptyText,
  action,
}: {
  title: string
  attempts: ActivityAttempt[]
  icon: ElementType
  tone?: 'default' | 'warn' | 'danger' | 'success'
  emptyText: string
  action?: ReactNode
}) {
  const visibleAttempts = attempts.slice(0, SECTION_LIMIT)
  const hiddenCount = Math.max(0, attempts.length - visibleAttempts.length)
  const toneClass =
    tone === 'danger' ? 'text-red-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'success' ? 'text-emerald-400'
    : 'text-muted-foreground'

  return (
    <section className="rounded-lg border border-border/40 bg-card/60">
      <div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
        <Icon className={cn('h-4 w-4', toneClass)} />
        <h2 className={cn('font-mono text-[11px] font-semibold uppercase tracking-widest', toneClass)}>
          {title}
        </h2>
        <Badge variant="outline" className="ml-1 border-border/50 font-mono text-[10px] text-muted-foreground">
          {attempts.length}
        </Badge>
        <div className="ml-auto">{action}</div>
      </div>
      {visibleAttempts.length > 0 ? (
        <div className="divide-y divide-border/30">
          {visibleAttempts.map((attempt) => (
            <ActivityAttemptRow key={attempt.id} attempt={attempt} showReason={tone === 'danger'} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground">{emptyText}</p>
      )}
      {hiddenCount > 0 && (
        <div className="border-t border-border/40 px-4 py-3 font-mono text-[11px] text-muted-foreground">
          Showing latest {visibleAttempts.length} of {attempts.length} attempts. Use search or project/spec pages for older records.
        </div>
      )}
    </section>
  )
}

function ActivityAttemptRow({ attempt, showReason }: { attempt: ActivityAttempt; showReason: boolean }) {
  const status = runDisplayStatus(attempt)
  const reason = showReason ? attempt.failReason ?? attempt.blockedReason : null
  const reasonLabel = reason == null ? null : compactReason(reason)
  const execution = executionModeBadgeLabel(attempt)
  const taskLabel = displayRunTaskName(attempt)
  const specLabel = displayStoredName(attempt.specName, 'Spec')
  return (
    <Link
      to={runHref(attempt)}
      className="block px-4 py-3 transition-colors hover:bg-accent/50"
      aria-label={`Open attempt ${taskLabel}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className={cn('border font-mono text-[10px]', statusToneClass(status))}>
              {runStatusLabel(attempt)}
            </Badge>
            <span className="min-w-0 truncate text-sm font-semibold tracking-normal">{taskLabel}</span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{attempt.projectName} / {specLabel}</span>
            <span className="text-muted-foreground/60">·</span>
            <span className="truncate">{attempt.agentName}</span>
            {attempt.agentModel && <span className="truncate font-mono text-[11px]">{attempt.agentModel}</span>}
            {execution && (
              <Badge variant="outline" className="border-border/50 font-mono text-[10px] text-muted-foreground">
                {execution}
              </Badge>
            )}
          </div>
          {reasonLabel && (
            <p className="mt-1 truncate text-xs text-red-300/80" title={reasonLabel}>
              {reasonLabel}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          <div>{timeAgo(attempt.lastHeartbeat ?? attempt.updatedAt)}</div>
          <div>{readableCostLabel(runCost(attempt))}</div>
        </div>
      </div>
    </Link>
  )
}

function compactReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 120) return normalized
  return `${normalized.slice(0, 117)}...`
}

function statusToneClass(status: ReturnType<typeof runDisplayStatus>): string {
  if (status === 'failed' || status === 'stalled') return 'border-red-500/50 text-red-300'
  if (status === 'awaiting_approval') return 'border-amber-500/50 text-amber-300'
  if (status === 'done') return 'border-emerald-500/40 text-emerald-300'
  return 'border-border/50 text-muted-foreground'
}

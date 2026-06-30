import { AlertTriangle, FileText, ShieldAlert, Terminal } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { EnrichedAttempt, EnrichedRun } from '@/api/client'
import { CopyButton } from '@/components/CopyButton'
import { Badge } from '@/components/ui/badge'
import { executionIssueLabel, executionModeBadgeLabel } from '@/lib/execution-integrity'
import { stageLabel, stageTone } from '@/lib/stage-display'
import { toneBadgeClass } from '@/components/signal'
import { runDisplayStatus, runHref, runStatusLabel, runStatusTone } from '@/lib/run-presentation'
import { cn, timeAgo } from '@/lib/utils'

const LIMIT = 8

type NeedsOperatorAttempt = EnrichedRun | EnrichedAttempt

export function NeedsOperatorSection({
  attempts,
  reportedCount,
}: {
  attempts: NeedsOperatorAttempt[]
  reportedCount?: number
}) {
  const visibleAttempts = attempts.slice(0, LIMIT)
  const hiddenCount = Math.max(0, attempts.length - visibleAttempts.length)
  const shownCount = attempts.length
  const hasReportedCount = reportedCount != null
  const displayCount = hasReportedCount ? reportedCount : shownCount
  const countDisagrees = hasReportedCount && reportedCount !== shownCount
  const countLabel =
    countDisagrees ? `${shownCount} shown / ${displayCount} reported` : `${shownCount}`

  return (
    <section className="rounded-lg border border-red-500/30 bg-red-950/10">
      <div className="flex flex-wrap items-center gap-2 border-b border-red-500/20 px-4 py-3">
	        <AlertTriangle className="h-4 w-4 text-red-300" />
	        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-red-300">
	          Failed or stalled attempts
	        </h2>
        <Badge variant="outline" className="border-red-500/40 font-mono text-[10px] text-red-200">
          {countLabel}
        </Badge>
        <p className="ml-auto text-xs text-red-100/70">
          {sectionSummary(shownCount)}
        </p>
      </div>
      {countDisagrees && (
        <p className="border-b border-red-500/15 px-4 py-2 text-xs text-red-100/70">
          {countMismatchText(shownCount, displayCount)}
        </p>
      )}
      {visibleAttempts.length > 0 ? (
        <div className="divide-y divide-red-500/15">
          {visibleAttempts.map((attempt) => (
            <NeedsOperatorItem key={attempt.id} attempt={attempt} />
          ))}
        </div>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground">
          {emptyStateText(displayCount)}
        </p>
      )}
      {hiddenCount > 0 && (
        <div className="border-t border-red-500/20 px-4 py-3 font-mono text-[11px] text-muted-foreground">
          Showing latest {visibleAttempts.length} of {attempts.length} attempts. Use search or project/spec pages for older records.
        </div>
      )}
    </section>
  )
}

function sectionSummary(shownCount: number): string {
  if (shownCount > 0) return 'Inspect logs and evidence before retrying or changing state.'
  return 'No failed or stalled run rows are shown in this fetched list.'
}

function countMismatchText(shownCount: number, reportedCount: number): string {
  if (reportedCount > shownCount) {
    return `Operator brief reports ${reportedCount} action items; this page has row details for ${shownCount}. Refresh or use ductum watch --once if the rows lag the count.`
  }
  return `Operator brief reports ${reportedCount} action items, but provides ${shownCount} row details. Treat the rows as current and the count as stale until the brief refreshes.`
}

function emptyStateText(displayCount: number): string {
  if (displayCount > 0) {
    return 'The operator brief reports action items, but no row details are available in this response. Use ductum watch --once for the exact attempts.'
  }
  return 'All clear · no attempts need operator action.'
}

function NeedsOperatorItem({ attempt }: { attempt: NeedsOperatorAttempt }) {
  const status = runDisplayStatus(attempt)
  const reason = latestSignal(attempt)
  const updatedAt = attempt.lastHeartbeat ?? attempt.updatedAt
  const canRetry = status === 'failed' || status === 'stalled'
  const execution = executionModeBadgeLabel(attempt)

  return (
    <article className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('border font-mono text-[10px]', statusToneClass(attempt))}>
            {runStatusLabel(attempt)}
          </Badge>
          <Badge variant="outline" className={cn('border font-mono text-[10px]', stageToneClass(attempt))}>
            {stageLabel(attempt.stage)}
          </Badge>
          {execution && (
            <Badge variant="outline" className="border-border/50 font-mono text-[10px] text-muted-foreground">
              {execution}
            </Badge>
          )}
          <Link
            to={runHref(attempt)}
            className="min-w-0 truncate text-sm font-semibold tracking-normal text-foreground hover:underline"
            aria-label={`Open attempt ${attempt.taskName}`}
          >
            {attempt.taskName}
          </Link>
        </div>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Field label="Project" value={attempt.projectName} />
          <Field label="Spec" value={attempt.specName} />
          <Field label="Task" value={attempt.taskName} />
          <Field label="Agent" value={agentLabel(attempt)} />
          <Field label="Attempt ID" value={attempt.id} mono copy />
          <Field label="Last activity" value={timeAgo(updatedAt)} />
        </dl>
        <div className="mt-3 rounded-md border border-red-500/20 bg-background/40 p-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-red-300">
            <FileText className="h-3.5 w-3.5" />
            Latest signal
          </div>
          <p className="mt-1 text-xs text-red-100/80">
            {reason ?? 'No failure reason is included in the activity list. Open the attempt logs and evidence before taking action.'}
          </p>
        </div>
        <div className="mt-3 rounded-md border border-amber-500/25 bg-amber-950/10 p-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5" />
            Retry risk
          </div>
          <p className="mt-1 text-xs text-amber-100/80">
            {retryRiskText(attempt)}
          </p>
        </div>
      </div>
      <div className="min-w-0 rounded-md border border-border/40 bg-card/60 p-3">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          Safe next actions
        </div>
        <div className="mt-3 space-y-2">
          <Link
            to={runHref(attempt)}
            className="block rounded border border-border/50 px-3 py-2 text-xs text-foreground hover:bg-accent/50"
          >
            Open attempt detail
          </Link>
          <CommandRow command={`ductum status ${attempt.id}`} />
          <CommandRow command={`ductum logs ${attempt.id}`} />
          <CommandRow command="ductum watch --once" />
          {canRetry ? (
            <div className="rounded border border-red-500/25 bg-red-950/10 p-2">
              <p className="text-[11px] text-red-100/75">
                Retry only after inspecting logs and the target worktree.
              </p>
              <CommandRow command={`ductum retry ${attempt.id}`} caution />
            </div>
          ) : (
            <p className="rounded border border-border/40 bg-background/40 p-2 text-[11px] text-muted-foreground">
              This is an execution-integrity item, not a retry prompt. Inspect evidence or repair the record before changing state.
            </p>
          )}
        </div>
      </div>
    </article>
  )
}

function Field({ label, value, mono = false, copy = false }: { label: string; value: string; mono?: boolean; copy?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 flex min-w-0 items-center gap-1 truncate text-foreground', mono && 'font-mono text-[11px]')}>
        <span className="truncate" title={value}>{value}</span>
        {copy && <CopyButton value={value} className="shrink-0" />}
      </dd>
    </div>
  )
}

function CommandRow({ command, caution = false }: { command: string; caution?: boolean }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 rounded border px-2 py-1.5', caution ? 'border-red-500/25 bg-red-950/20' : 'border-border/40 bg-background/50')}>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{command}</code>
      <CopyButton value={command} className="shrink-0" />
    </div>
  )
}

function agentLabel(attempt: NeedsOperatorAttempt): string {
  if (attempt.agentModel == null || attempt.agentModel === '') return attempt.agentName
  return `${attempt.agentName} (${attempt.agentModel})`
}

function retryRiskText(attempt: NeedsOperatorAttempt): string {
  const paths = attempt.worktreePaths?.filter((path) => path.trim() !== '') ?? []
  if (paths.length === 0) {
    return 'No worktree state is included in this list response. Treat retry as unsafe until status/logs confirm no dirty or partial edits remain.'
  }
  const suffix = paths.length === 1 ? paths[0] : `${paths[0]} and ${paths.length - 1} more`
  return `Worktree state may contain dirty or partial edits at ${suffix}. Inspect before retry.`
}

function latestSignal(attempt: NeedsOperatorAttempt): string | null {
  const reason = compactReason(attempt.failReason ?? attempt.blockedReason)
  if (reason != null) return reason
  const issue = attempt.executionIssues?.[0]
  if (issue == null) return null
  const detail = compactReason(issue.message)
  const label = executionIssueLabel(issue.code)
  return detail == null || detail === label ? label : `${label}: ${detail}`
}

function compactReason(reason: string | null | undefined): string | null {
  const normalized = reason?.replace(/\s+/g, ' ').trim()
  if (normalized == null || normalized === '') return null
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 177)}...`
}

function stageToneClass(attempt: NeedsOperatorAttempt): string {
  if (attempt.terminalState === 'stalled') return toneBadgeClass(stageTone('stalled'))
  if (attempt.terminalState === 'failed') return toneBadgeClass(stageTone('failed'))
  return toneBadgeClass(stageTone(attempt.stage))
}

function statusToneClass(attempt: NeedsOperatorAttempt): string {
  return toneBadgeClass(runStatusTone(attempt))
}

import { useNavigate } from 'react-router-dom'

import type { Run, RunActivity } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { DISPLAY_STATUS_CLASSES, type DisplayStatus } from '@/lib/derived-status'
import { compactActivityText, operatorActivityLabel } from '@/lib/run-activity-labels'
import { runCost, runDisplayStatus, runStatusLabel } from '@/lib/run-presentation'
import { cn, formatTime, timeAgo } from '@/lib/utils'

interface Props {
  run: Run
  activity: RunActivity[]
  siblingRuns: Run[]
  projectName: string
  specName: string
  taskName: string
}

function enc(s: string): string {
  return encodeURIComponent(s)
}

/** Derive a short human-readable cause from fail_reason and run fields. */
function deriveCause(run: Run): string {
  if (run.failReason) return run.failReason
  if (run.terminalState === 'stalled') {
    const timeout = run.heartbeatTimeoutSeconds
    return `Heartbeat timeout (no activity for ${timeout}s)`
  }
  return 'Unknown failure'
}

/** Find the last non-MCP tool_call in the activity feed. */
function lastToolCallEntry(activity: RunActivity[]): RunActivity | null {
  for (let i = activity.length - 1; i >= 0; i--) {
    const a = activity[i]!
    if (a.kind === 'tool_call' && a.toolName && !a.toolName.startsWith('mcp__')) {
      return a
    }
  }
  return null
}

/** Count sibling runs by terminal state / done stage. */
function countByOutcome(runs: Run[]): { stalled: number; failed: number; done: number } {
  let stalled = 0
  let failed = 0
  let done = 0
  for (const r of runs) {
    if (r.terminalState === 'stalled') stalled++
    else if (r.terminalState === 'failed') failed++
    else if (r.stage === 'done') done++
  }
  return { stalled, failed, done }
}

function runOutcomeKey(r: Run): DisplayStatus {
  return runDisplayStatus(r)
}

function runOutcomeLabel(r: Run): string {
  const status = runDisplayStatus(r)
  if (status === 'stalled') return r.failReason ?? 'heartbeat timeout'
  if (status === 'failed') return r.failReason ?? 'failed'
  if (status === 'done') return runCost(r).label
  return runStatusLabel(r).toLowerCase()
}

export function FailureSummaryCard({ run, activity, siblingRuns, projectName, specName, taskName }: Props) {
  const navigate = useNavigate()

  const cause = deriveCause(run)
  const lastAction = lastToolCallEntry(activity)
  const lastActionLabel = lastAction ? operatorActivityLabel(lastAction) : null
  const lastActionMeta = lastActionLabel?.meta ? compactActivityText(lastActionLabel.meta, 80) : null
  const outcomes = countByOutcome(siblingRuns)
  const totalParts: string[] = []
  if (outcomes.stalled > 0) totalParts.push(`${outcomes.stalled} stalled`)
  if (outcomes.failed > 0) totalParts.push(`${outcomes.failed} failed`)
  if (outcomes.done > 0) totalParts.push(`${outcomes.done} done`)
  const attemptsDetail = totalParts.join(', ')

  return (
    <Card className="border-l-4 border-l-red-500 bg-card/80 dark:border-l-red-400">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-red-500" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-red-600 dark:text-red-400">
            Failure Summary
          </span>
        </div>

        <div className="h-px bg-border/40" />

        {/* Cause */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold text-muted-foreground/60 w-20 shrink-0">Cause</span>
          <span className="text-sm text-foreground/90">{cause}</span>
        </div>

        {/* Last action */}
        {lastAction && lastActionLabel && (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground/60 w-20 shrink-0">Last action</span>
            <span className="text-sm text-foreground/80">
              <span className="font-mono text-[12px] text-primary/80">{lastActionLabel.title}</span>
              {lastActionMeta && (
                <>
                  {' '}
                  <span className="text-muted-foreground">{lastActionMeta}</span>
                </>
              )}
              {' '}
              <span className="font-mono text-[10px] text-muted-foreground/50">({formatTime(lastAction.createdAt)}, {timeAgo(lastAction.createdAt)})</span>
            </span>
          </div>
        )}

        {/* Attempts summary */}
        {siblingRuns.length > 0 && (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] font-semibold text-muted-foreground/60 w-20 shrink-0">Attempts</span>
            <span className="text-sm text-muted-foreground">
              {siblingRuns.length} total{attemptsDetail ? ` (${attemptsDetail})` : ''}
            </span>
          </div>
        )}

        {/* Lineage list */}
        {siblingRuns.length > 1 && (
          <div className="space-y-1 pt-1">
            {siblingRuns.map((sibling, i) => {
              const isCurrentRun = sibling.id === run.id
              const outcomeKey = runOutcomeKey(sibling)
              const outcomeLabel = runOutcomeLabel(sibling)
              const shortRunId = sibling.id.slice(0, 6)

              return (
                <button
                  type="button"
                  key={sibling.id}
                  disabled={isCurrentRun}
                  onClick={() => navigate(`/${enc(projectName)}/${enc(specName)}/${enc(taskName)}/${shortRunId}`)}
                  aria-current={isCurrentRun ? 'true' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1 font-mono text-[12px]',
                    isCurrentRun
                      ? 'bg-muted/30 ring-1 ring-border/50'
                      : 'hover:bg-muted/20',
                  )}
                >
                  <span className="text-muted-foreground/50 shrink-0 w-10">#{i + 1}</span>
                  <Badge
                    variant="outline"
                    className={cn('border font-mono text-[10px] shrink-0', DISPLAY_STATUS_CLASSES[outcomeKey])}
                  >
                    {runStatusLabel(sibling)}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words text-muted-foreground/70">{outcomeLabel}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/40">{formatTime(sibling.createdAt)}</span>
                  {isCurrentRun && (
                    <span className="shrink-0 font-mono text-[10px] text-primary/60 italic">← you are here</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

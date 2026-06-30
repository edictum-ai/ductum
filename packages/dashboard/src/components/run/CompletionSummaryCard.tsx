import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { Run, RunActivity } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { parseReviewResultSummary } from '@/lib/review-result'

const COLLAPSE_THRESHOLD = 500

interface Props {
  run: Run
  activity: RunActivity[]
  nextTaskHref?: string
}

/**
 * Derive the completion summary text from the run, following priority order:
 * 1. run.completionSummary (DB field set by agent at done time)
 * 2. Last activity entry with kind === 'result'
 * 3. Last activity entry with kind === 'text'
 */
function deriveCompletionText(run: Run, activity: RunActivity[]): string | null {
  if (run.completionSummary) return run.completionSummary

  // Walk backward through activity to find the last 'result' or 'text' entry
  let lastText: string | null = null
  for (let i = activity.length - 1; i >= 0; i--) {
    const a = activity[i]!
    if (a.kind === 'result') return a.content
    if (a.kind === 'text' && lastText == null) {
      lastText = a.content
    }
  }
  return lastText
}

export function CompletionSummaryCard({ run, activity, nextTaskHref }: Props) {
  const [expanded, setExpanded] = useState(false)

  const text = deriveCompletionText(run, activity)
  if (!text) return null

  const reviewResult = parseReviewResultSummary(text)
  const isLong = text.length > COLLAPSE_THRESHOLD
  const displayText = isLong && !expanded ? text.slice(0, COLLAPSE_THRESHOLD) + '…' : text
  const commitLabel = run.commitSha?.slice(0, 8) ?? null
  const doneLabel = commitLabel == null ? 'Marked done' : `Merged to main ${commitLabel}`

  if (reviewResult != null) {
    const tone = reviewTone(reviewResult.verdict)
    return (
      <Card className={`border-l-4 ${tone.border} bg-card/80`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${tone.dot}`} />
              <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${tone.text}`}>
                Review verdict
              </span>
            </div>
            <span className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${tone.text}`}>
              {reviewResult.verdict}
            </span>
          </div>
          <div className="h-px bg-border/40" />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 bg-background/40 px-3 py-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Attempt done
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">{doneLabel}</span>
            {run.prUrl && (
              <Button asChild variant="ghost" size="sm" className="h-7">
                <a href={run.prUrl} target="_blank" rel="noopener noreferrer">Open PR</a>
              </Button>
            )}
          </div>
          {reviewResult.summary != null && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
              {reviewResult.summary}
            </p>
          )}
          {reviewResult.findings.length > 0 && (
            <div className="space-y-2">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Findings
              </div>
              <ul className="space-y-2 text-sm leading-relaxed text-foreground/85">
                {reviewResult.findings.map((finding, index) => (
                  <li key={`${index}-${finding}`} className="rounded-md border border-border/45 bg-background/35 px-3 py-2">
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-l-4 border-l-emerald-500 bg-card/80 dark:border-l-emerald-400">
      <CardContent className="p-4 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              Completion Summary
            </span>
          </div>
          {isLong && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 font-mono text-[10px] text-muted-foreground/60 hover:text-foreground"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
        </div>

        <div className="h-px bg-border/40" />

        <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            {doneLabel}
          </span>
          {nextTaskHref && (
            <Button asChild variant="outline" size="sm" className="h-7">
              <Link to={nextTaskHref}>Open next task</Link>
            </Button>
          )}
          {run.prUrl && (
            <Button asChild variant="ghost" size="sm" className="h-7">
              <a href={run.prUrl} target="_blank" rel="noopener noreferrer">Open PR</a>
            </Button>
          )}
        </div>

        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">
          {displayText}
        </p>

        {isLong && !expanded && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-0 font-mono text-[11px] text-primary/70 hover:text-primary"
            onClick={() => setExpanded(true)}
          >
            Show full summary ({text.length.toLocaleString()} chars)
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function reviewTone(verdict: string): { border: string; dot: string; text: string } {
  if (verdict === 'PASS') return { border: 'border-l-emerald-500 dark:border-l-emerald-400', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
  if (verdict === 'WARN') return { border: 'border-l-amber-500 dark:border-l-amber-400', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  if (verdict === 'FAIL') return { border: 'border-l-red-500 dark:border-l-red-400', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' }
  return { border: 'border-l-border', dot: 'bg-muted-foreground', text: 'text-muted-foreground' }
}

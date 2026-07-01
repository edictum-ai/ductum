/**
 * Live activity timeline — chronological feed of recent factory
 * events. Sits in the right rail of the homepage so operators can
 * scan "what just changed" without watching individual rows.
 *
 * Powered by useActivityFeed which subscribes to /api/events/stream
 * directly and accumulates the most recent 60 events.
 */

import { Activity, AlertCircle, ArrowRight, CheckCircle2, GitMerge, Hammer } from 'lucide-react'
import type { ElementType } from 'react'
import { useNavigate } from 'react-router-dom'

import { useActivityFeed, type ActivityEvent, type ActivityEventKind } from '@/api/activity-feed'
import { shortId } from '@/lib/display'
import { displayStoredName } from '@/lib/project-display'
import { cn, timeAgo } from '@/lib/utils'

const KIND_ICON: Record<ActivityEventKind, ElementType> = {
  dispatched: Hammer,
  stage_changed: ArrowRight,
  approval_requested: GitMerge,
  gate_evaluated: CheckCircle2,
  task_status_changed: AlertCircle,
}

const KIND_COLOR: Record<ActivityEventKind, string> = {
  dispatched: 'text-blue-400',
  stage_changed: 'text-cyan-300',
  approval_requested: 'text-amber-300',
  gate_evaluated: 'text-emerald-300',
  task_status_changed: 'text-purple-300',
}

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

export function ActivityTimeline() {
  const events = useActivityFeed()
  const navigate = useNavigate()

  return (
    <div className="rounded-lg border border-border/40 bg-card/40">
      <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
          Live activity
        </span>
        {events.length > 0 && (
          <span className="font-mono text-[9px] text-muted-foreground/40">({events.length})</span>
        )}
        <span className="live-dot ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400/70" aria-label="live" />
      </div>
      {events.length === 0 ? (
        <div className="px-3 py-4 text-center font-mono text-[10px] text-muted-foreground/50">
          waiting for events…
        </div>
      ) : (
        <ul className="max-h-[520px] divide-y divide-border/20 overflow-y-auto">
          {events.map((ev) => (
            <ActivityRow key={ev.id} event={ev} onNavigate={navigate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent
  onNavigate: (path: string) => void
}) {
  const Icon = KIND_ICON[event.kind]
  const color = KIND_COLOR[event.kind]
  const specLabel = event.specName == null ? null : displayStoredName(event.specName, 'Spec')
  const url =
    event.projectName && event.specName && event.taskName && event.runId
      ? `/${enc(event.projectName)}/${enc(event.specName)}/${enc(event.taskName)}/${shortId(event.runId)}`
      : event.projectName && event.specName
        ? `/${enc(event.projectName)}/${enc(event.specName)}`
        : null

  return (
    <li>
      <button
        type="button"
        className={cn(
          'group flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
          url ? 'hover:bg-accent/40' : 'cursor-default',
        )}
        onClick={() => {
          if (url) onNavigate(url)
        }}
      >
        <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', color)} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[10px] text-foreground/85">{event.headline}</p>
          {event.detail && (
            <p className="mt-0.5 line-clamp-2 font-mono text-[9px] text-muted-foreground/60">
              {event.detail}
            </p>
          )}
          <div className="mt-0.5 flex items-center gap-2 font-mono text-[8px] text-muted-foreground/50">
            <span>{timeAgo(event.receivedAt)}</span>
            {event.projectName && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span>{event.projectName}</span>
              </>
            )}
            {specLabel && (
              <>
                <span className="text-muted-foreground/30">›</span>
                <span>{specLabel}</span>
              </>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

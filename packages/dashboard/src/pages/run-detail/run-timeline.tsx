import { useEffect, useMemo, useRef, useState } from 'react'

import type { Decision, Evidence, GateEvaluation, RunActivity, RunStageTransition, RunUpdate } from '@/api/client'
import type { DuctumSSEStatus } from '@/api/sse'
import { Badge } from '@/components/ui/badge'
import { Btn, Dot, Mono, tokens, toneBadgeClass, toneColor, type Tone } from '@/components/signal'
import { displayDecisionContext, displayDecisionTitle } from '@/lib/project-display'
import { operatorActivityLabel, redactSensitiveText } from '@/lib/run-activity-labels'
import { evidenceTone, gateTone, stageLabel, stageTone } from '@/lib/stage-display'
import { cn, formatTime } from '@/lib/utils'

interface RunTimelineProps {
  activity: RunActivity[]
  evidence: Evidence[]
  transitions: RunStageTransition[]
  gates: GateEvaluation[]
  decisions: Decision[]
  updates: RunUpdate[]
  sseStatus: DuctumSSEStatus
}

interface TimelineItem {
  id: string
  at: string
  rank: number
  kind: string
  title: string
  meta?: string
  detail?: string
  tone: Tone
}

export function RunTimeline({ activity, evidence, transitions, gates, decisions, updates, sseStatus }: RunTimelineProps) {
  const [followLive, setFollowLive] = useState(true)
  const topRef = useRef<HTMLDivElement | null>(null)
  const items = useMemo(
    () => buildTimeline({ activity, evidence, transitions, gates, decisions, updates }),
    [activity, evidence, transitions, gates, decisions, updates],
  )

  useEffect(() => {
    const node = topRef.current
    if (!followLive || node == null || typeof node.scrollIntoView !== 'function') return
    node.scrollIntoView({ block: 'nearest' })
  }, [followLive, items.length])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Dot color={toneColor(statusTone(sseStatus))} size={7} pulse={followLive && sseStatus === 'connected'} />
          <Mono size={11} color={tokens.dim}>SSE {sseStatus}</Mono>
        </div>
        <Btn small ghost={!followLive} primary={followLive} onClick={() => setFollowLive(!followLive)}>
          Live follow {followLive ? 'on' : 'off'}
        </Btn>
      </div>
      <div ref={topRef} />
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No timeline events recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <article key={item.id} className="relative rounded-md border border-border/30 bg-muted/10 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('h-2 w-2 rounded-full', index === 0 ? 'bg-primary' : 'bg-muted-foreground/30')} />
                <span className="font-mono text-[10px] text-muted-foreground/50">{formatTime(item.at)}</span>
                <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(item.tone))}>{item.kind}</Badge>
                {index === 0 && <span className="font-mono text-[10px] text-primary/60">latest</span>}
              </div>
              <div className="mt-2 min-w-0">
                <p className="break-words text-[13px] font-medium text-foreground/90">{item.title}</p>
                {item.meta && <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground/70">{item.meta}</p>}
                {item.detail && <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function buildTimeline(input: Omit<RunTimelineProps, 'sseStatus'>): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const item of input.transitions) items.push(transitionItem(item))
  for (const item of input.gates) items.push(gateItem(item))
  for (const item of input.evidence) items.push(evidenceItem(item))
  for (const item of input.decisions) items.push(decisionItem(item))
  for (const item of input.updates) items.push(updateItem(item))
  for (const item of input.activity) items.push(activityItem(item))
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.rank - b.rank || a.id.localeCompare(b.id))
}

function transitionItem(item: RunStageTransition): TimelineItem {
  const from = stageLabel(item.fromStage)
  const to = stageLabel(item.toStage)
  return {
    id: `transition:${item.id}`,
    at: item.createdAt,
    rank: 10,
    kind: 'transition',
    title: item.fromStage === item.toStage ? `${to} reset` : `${from} -> ${to}`,
    detail: item.reason ?? undefined,
    tone: stageTone(item.toStage),
  }
}

function gateItem(item: GateEvaluation): TimelineItem {
  return {
    id: `gate:${item.id}`,
    at: item.createdAt,
    rank: 20,
    kind: 'gate',
    title: `${item.gateType} ${item.observed ? 'observed' : item.result}`,
    meta: item.target,
    detail: item.reason ?? 'No reason recorded',
    tone: item.observed ? 'warn' : gateTone(item.result),
  }
}

function evidenceItem(item: Evidence): TimelineItem {
  const payloadKind = typeof item.payload.kind === 'string' ? item.payload.kind : undefined
  return {
    id: `evidence:${item.id}`,
    at: item.createdAt,
    rank: 30,
    kind: 'evidence',
    title: payloadKind ?? item.type,
    meta: `evidence ${item.id}`,
    detail: item.type,
    tone: evidenceTone(item.type),
  }
}

function decisionItem(item: Decision): TimelineItem {
  return {
    id: `decision:${item.id}`,
    at: item.createdAt,
    rank: 40,
    kind: 'decision',
    title: displayDecisionTitle(item),
    meta: `by ${item.decidedBy}`,
    detail: displayDecisionContext(item.context),
    tone: 'accent',
  }
}

function updateItem(item: RunUpdate): TimelineItem {
  const message = redactSensitiveText(item.message)
  return {
    id: `update:${item.id}`,
    at: item.createdAt,
    rank: 50,
    kind: 'update',
    title: compact(message, 120),
    detail: message.includes('\n') ? message : undefined,
    tone: 'info',
  }
}

function activityItem(item: RunActivity): TimelineItem {
  const label = operatorActivityLabel(item)
  const raw = label.raw == null ? undefined : compact(redactSensitiveText(label.raw), 160)
  return {
    id: `activity:${item.id}`,
    at: item.createdAt,
    rank: 60,
    kind: item.kind,
    title: label.title,
    meta: label.meta,
    detail: raw == null || raw === label.title || raw === label.meta ? undefined : raw,
    tone: label.tone ?? 'info',
  }
}

function statusTone(status: DuctumSSEStatus): Tone {
  if (status === 'connected') return 'ok'
  if (status === 'connecting' || status === 'reconnecting') return 'warn'
  return 'mid'
}

function compact(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}...` : oneLine
}

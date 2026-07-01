import type { CSSProperties } from 'react'

import type { RunActivity } from '@/api/client'
import { Btn, Caps, Dot, Mono, tokens } from '@/components/signal'
import { downloadTranscript } from './transcript'
import type { RunType } from './types'

export function RunDetailHero({
  run,
  taskTitle,
  summaryText,
  statusLabel,
  toneColor,
  running,
  approval,
  activity,
}: {
  run: RunType
  taskTitle: string
  summaryText: string
  statusLabel: string
  toneColor: string
  running: boolean
  approval: boolean
  activity: RunActivity[]
}) {
  const transcriptReason = activity.length === 0
    ? 'Unlocks when attempt activity has been recorded.'
    : undefined
  const disabledReasons = [
    transcriptReason && ['Transcript', transcriptReason],
  ].filter((item): item is [string, string] => Array.isArray(item))
  const heroWrap: CSSProperties = {
    gap: 32,
    marginBottom: 28,
  }
  const heroTitle: CSSProperties = {
    margin: '12px 0 0',
    fontFamily: tokens.mono,
    fontWeight: 500,
    lineHeight: 1.05,
    letterSpacing: -0.5,
    color: tokens.strong,
  }

  return (
    <div style={heroWrap} className="grid grid-cols-1 lg:grid-cols-[1fr_auto] lg:items-end">
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Dot color={toneColor} size={8} pulse={running || approval} />
          <Caps color={toneColor}>{statusLabel}</Caps>
          <span style={{ color: tokens.faint }}>·</span>
          {/* Long run ids (UUID-shaped, no natural break points) must wrap
              inside the hero meta row instead of pushing the page wider than
              the viewport. `break-all` lets the id wrap at any character;
              `min-w-0` lets the flex item shrink below its intrinsic width. */}
          <span className="break-all min-w-0 max-w-full">
            <Mono size={12} color={tokens.dim}>{run.id}</Mono>
          </span>
        </div>
        <h1 style={heroTitle} className="break-words min-w-0 text-[26px] sm:text-[32px] lg:text-[40px]">{taskTitle}</h1>
        {summaryText && (
          <div style={{ marginTop: 10, fontSize: 15, color: tokens.mid, lineHeight: 1.5, maxWidth: 680, whiteSpace: 'pre-wrap' }}>
            {summaryText}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gap: 8, justifyItems: 'end', flexShrink: 0, maxWidth: 360 }}>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {run.prUrl && <Btn onClick={() => window.open(run.prUrl!, '_blank', 'noopener,noreferrer')}>Open PR</Btn>}
          <Btn disabled={activity.length === 0} onClick={() => downloadTranscript(run, activity)} title={transcriptReason}>Transcript</Btn>
        </div>
        {disabledReasons.length > 0 && (
          <div style={{ display: 'grid', gap: 4, textAlign: 'right' }}>
            {disabledReasons.map(([label, reason]) => (
              <Mono key={label} size={11} color={tokens.dim} style={{ lineHeight: 1.45 }}>
                {label} disabled: {reason}
              </Mono>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

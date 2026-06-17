import { useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENTS, RUN_ID, TRACE, type AgentState, type TraceEvent } from './data'
import { ActivityFeed, type FeedItem } from './ActivityFeed'
import { FleetGraph } from './FleetGraph'
import { EvidenceModal } from './EvidenceModal'
import { EVIDENCE } from './evidence'

const MAX_FEED = 8
const LOOP_BEAT = 2200

function initialStates(): Record<string, AgentState> {
  const s: Record<string, AgentState> = {}
  for (const a of AGENTS) s[a.id] = 'queued'
  return s
}

/** Deterministic timestamp from event count (not wall clock). */
function detTs(count: number): string {
  const secs = Math.floor(count * 1.7)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return `00:${mm}:${ss}`
}

export function Terminal() {
  const reducedMotion = useReducedMotion() ?? false
  const [states, setStates] = useState<Record<string, AgentState>>(initialStates)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [eventCount, setEventCount] = useState(0)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)

  const eventCounter = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const addFeed = useCallback((kind: TraceEvent['kind'], text: string) => {
    eventCounter.current += 1
    const id = eventCounter.current
    const item: FeedItem = { id, kind, text, ts: detTs(id) }
    setFeed((prev) => [item, ...prev].slice(0, MAX_FEED))
    setEventCount(id)
  }, [])

  const handleEvent = useCallback(
    (ev: TraceEvent) => {
      if (ev.agentId && ev.state) {
        const id = ev.agentId
        const newState = ev.state
        setStates((prev) => ({ ...prev, [id]: newState }))
      }
      addFeed(ev.kind, ev.text)
    },
    [addFeed],
  )

  const resetVisual = useCallback(() => {
    setStates(initialStates())
    setFeed([])
    eventCounter.current = 0
    setEventCount(0)
  }, [])

  const playTrace = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = []

    resetVisual()

    for (const ev of TRACE) {
      const id = setTimeout(() => handleEvent(ev), ev.t)
      timers.current.push(id)
    }

    const lastT = TRACE[TRACE.length - 1]?.t ?? 0
    const loopId = setTimeout(playTrace, lastT + LOOP_BEAT)
    timers.current.push(loopId)
  }, [handleEvent, resetVisual])

  // Play or static snapshot
  useEffect(() => {
    if (reducedMotion) {
      // fully-resolved graph + filled feed + pre-selected failure evidence
      const snapshot: Record<string, AgentState> = {
        a1: 'done',
        a2: 'done',
        a3: 'done',
        a4: 'failed',
        a5: 'done',
        a6: 'queued',
      }
      setStates(snapshot)
      const snapshotFeed: [TraceEvent['kind'], string][] = [
        ['queued', 'coordinator opened dispatch — ' + RUN_ID],
        ['done', 'agent-compile · attempt recorded'],
        ['done', 'agent-test · attempt recorded'],
        ['failed', 'agent-migrate · FAILED · retry 2/3'],
        ['gate', 'gate · verify-before-push · BLOCK · evidence sealed'],
      ]
      snapshotFeed.forEach(([k, t]) => addFeed(k, t))
      setSelectedAgent('a4')
      return
    }

    const startId = setTimeout(playTrace, 500)
    timers.current.push(startId)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const ev = selectedAgent ? EVIDENCE[selectedAgent] : null

  return (
    <div
      aria-label="Live dispatch terminal"
      style={{
        position: 'relative',
        background: 'var(--panel)',
        border: '1px solid var(--ink-line-2)',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,.45), 0 0 0 1px rgba(47,111,237,.05)',
      }}
    >
      {/* terminal bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '11px 16px',
          background: 'var(--panel-2)',
          borderBottom: '1px solid var(--ink-line)',
          fontFamily: 'var(--mono)',
          fontSize: 11,
          letterSpacing: '0.04em',
          color: 'var(--ink-faint)',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ display: 'flex', gap: 7 }} aria-hidden="true">
          <Dot />
          <Dot />
          <Dot />
        </span>
        <span style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
          <b style={{ color: 'var(--ink-dim)', fontWeight: 500 }}>ductum</b> · dispatch.live // run{' '}
          <b style={{ color: 'var(--ink)' }}>{RUN_ID}</b>
        </span>
        <span style={{ color: 'var(--running)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span className="pulse-dot" aria-hidden="true" />
          REPLAY
        </span>
      </div>

      <div
        className="term-body"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 280px',
          minHeight: 420,
        }}
      >
        {/* graph stage */}
        <div
          className="graph-stage"
          style={{
            position: 'relative',
            background:
              'radial-gradient(ellipse 70% 60% at 26% 50%, rgba(47,111,237,.07), transparent 70%), var(--void)',
            borderRight: '1px solid var(--ink-line)',
            minHeight: 420,
          }}
        >
          {!reducedMotion && (
            <div
              className="scanline"
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: 90,
                pointerEvents: 'none',
                background: 'linear-gradient(180deg, transparent, rgba(47,111,237,.05), transparent)',
                animation: 'scan 9s linear infinite',
              }}
            />
          )}

          <svg
            viewBox="0 0 760 420"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="Coordinator dispatching to six agents; one fails and a gate blocks the run. Click a node to inspect its evidence bundle."
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
          >
            <FleetGraph
              states={states}
              selectedId={selectedAgent}
              onSelect={setSelectedAgent}
              reducedMotion={reducedMotion}
            />
          </svg>

          {/* legend */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 16,
              bottom: 14,
              zIndex: 3,
              display: 'flex',
              gap: 14,
              flexWrap: 'wrap',
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
            }}
          >
            <LegendItem color="var(--queued)" label="queued" />
            <LegendItem color="var(--running)" label="running" />
            <LegendItem color="var(--done)" label="done" />
            <LegendItem color="var(--failed)" label="failed" />
          </div>
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 14,
              zIndex: 3,
              fontFamily: 'var(--mono)',
              fontSize: 10,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ink-dim)',
            }}
          >
            replays a recorded run · {RUN_ID}
          </div>
        </div>

        <ActivityFeed items={feed} count={eventCount} />
      </div>

      <EvidenceModal
        agentId={selectedAgent}
        attempt={ev?.attempt ?? null}
        json={ev?.json ?? null}
        onClose={() => setSelectedAgent(null)}
      />

      <style>{`
        @media (max-width: 900px) {
          .term-body { grid-template-columns: 1fr !important; }
          .graph-stage { border-right: none !important; border-bottom: 1px solid var(--ink-line) !important; }
        }
      `}</style>
    </div>
  )
}

function Dot() {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: 'var(--ink-line-2)',
      }}
    />
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: color }} />
      {label}
    </span>
  )
}

/* ============================================================
   DETERMINISM: ONE authored trace drives the entire terminal.
   No Math.random(). State transitions, dwell times, the failure,
   and the gate block are all fixed values. This is the point.
   ============================================================ */

export const RUN_ID = 'run_7c1f3a'

export type AgentState = 'queued' | 'running' | 'done' | 'failed'

export interface AgentNode {
  id: string
  name: string
  att: string
  x: number
  y: number
  state: AgentState
}

export const COORD: Readonly<{ x: number; y: number }> = { x: 120, y: 210 }

export const AGENTS: AgentNode[] = [
  { id: 'a1', name: 'agent-compile', att: 'att-31', x: 556, y: 52, state: 'queued' },
  { id: 'a2', name: 'agent-test', att: 'att-32', x: 638, y: 118, state: 'queued' },
  { id: 'a3', name: 'agent-lint', att: 'att-33', x: 666, y: 210, state: 'queued' },
  { id: 'a4', name: 'agent-migrate', att: 'att-34', x: 638, y: 302, state: 'queued' },
  { id: 'a5', name: 'agent-review', att: 'att-35', x: 556, y: 368, state: 'queued' },
  { id: 'a6', name: 'agent-ship', att: 'att-36', x: 452, y: 396, state: 'queued' },
]

export const STATE_COLORS: Record<AgentState, string> = {
  queued: '#38BDF8',
  running: '#2F6FED',
  done: '#10B981',
  failed: '#EF4444',
}

export type EventKind = 'queued' | 'dispatch' | 'done' | 'failed' | 'gate' | 'reset'

export interface TraceEvent {
  t: number
  agentId: string | null
  kind: EventKind
  state?: AgentState
  text: string
}

/**
 * The authored dispatch trace.
 * Deterministic outcome: a4 (agent-migrate) FAILS; gate then BLOCKS the run.
 */
export const TRACE: TraceEvent[] = [
  { t: 0, agentId: null, kind: 'queued', text: 'coordinator opened dispatch — ' + RUN_ID },
  { t: 600, agentId: 'a1', kind: 'dispatch', state: 'running', text: 'dispatch → agent-compile · ' + RUN_ID },
  { t: 1050, agentId: 'a2', kind: 'dispatch', state: 'running', text: 'dispatch → agent-test · ' + RUN_ID },
  { t: 1500, agentId: 'a3', kind: 'dispatch', state: 'running', text: 'dispatch → agent-lint · ' + RUN_ID },
  { t: 1950, agentId: 'a4', kind: 'dispatch', state: 'running', text: 'dispatch → agent-migrate · ' + RUN_ID },
  { t: 2400, agentId: 'a5', kind: 'dispatch', state: 'running', text: 'dispatch → agent-review · ' + RUN_ID },
  // a6 (agent-ship) is NOT dispatched — ci-green-before-merge holds it queued.
  { t: 3400, agentId: 'a1', kind: 'done', state: 'done', text: 'agent-compile · attempt recorded' },
  { t: 3900, agentId: 'a3', kind: 'done', state: 'done', text: 'agent-lint · attempt recorded' },
  { t: 4400, agentId: 'a2', kind: 'done', state: 'done', text: 'agent-test · attempt recorded' },
  // THE FAILURE — a4 fails after a fixed dwell, fail-closed semantics.
  { t: 5200, agentId: 'a4', kind: 'failed', state: 'failed', text: 'agent-migrate · FAILED · retry 2/3' },
  // THE GATE BLOCK — verify-before-push fires block, run halts, evidence records.
  { t: 5900, agentId: null, kind: 'gate', text: 'gate · verify-before-push · BLOCK · evidence sealed' },
  { t: 6500, agentId: 'a5', kind: 'done', state: 'done', text: 'agent-review · attempt recorded' },
  // pause, then loop
  { t: 9500, agentId: null, kind: 'reset', text: 'coordinator replaying trace — ' + RUN_ID },
]

export interface FeedGlyph {
  kind: EventKind
  glyph: string
}

export const FEED_GLYPHS: Record<EventKind, string> = {
  dispatch: '→',
  done: '✓',
  failed: '✕',
  queued: '►',
  gate: '■',
  reset: '↻',
}

/** Edge path generator — quadratic curve from coordinator to agent. */
export function edgePath(a: AgentNode): string {
  const mx = (COORD.x + a.x) / 2 + 30
  const my = (COORD.y + a.y) / 2
  return `M ${COORD.x} ${COORD.y} Q ${mx} ${my} ${a.x} ${a.y}`
}

/** Human-readable state label for a node, honoring special cases. */
export function stateLabel(agentId: string, state: AgentState): string {
  if (agentId === 'a6' && state === 'queued') return 'QUEUED · HELD'
  if (agentId === 'a4' && state === 'failed') return 'FAILED · 2/3'
  return state.toUpperCase()
}

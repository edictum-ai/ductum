import { motion } from 'framer-motion'
import { AGENTS, COORD, STATE_COLORS, edgePath, stateLabel, type AgentState } from './data'

/** Background fill for a node based on its current state. */
function nodeBgFill(state: AgentState): string {
  switch (state) {
    case 'running':
      return 'rgba(47,111,237,.16)'
    case 'done':
      return 'rgba(16,185,129,.10)'
    case 'failed':
      return 'rgba(239,68,68,.12)'
    default:
      return 'var(--panel-2)'
  }
}

/** Edge stroke color based on agent state. */
function edgeStroke(state: AgentState): string {
  switch (state) {
    case 'running':
      return 'var(--blue-line)'
    case 'failed':
      return 'rgba(239,68,68,.40)'
    default:
      return 'var(--ink-line-2)'
  }
}

interface FleetGraphProps {
  states: Record<string, AgentState>
  selectedId: string | null
  onSelect: (agentId: string) => void
  reducedMotion: boolean
}

export function FleetGraph({ states, selectedId, onSelect, reducedMotion }: FleetGraphProps) {
  return (
    <>
      <defs>
        <radialGradient id="pulseGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#5b8ff5" stopOpacity={1} />
          <stop offset="60%" stopColor="#2F6FED" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#2F6FED" stopOpacity={0} />
        </radialGradient>
        <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* edges */}
      <g strokeLinecap="round">
        {AGENTS.map((a) => {
          const state = states[a.id] ?? 'queued'
          const d = edgePath(a)
          return (
            <motion.path
              key={`edge-${a.id}`}
              d={d}
              fill="none"
              strokeWidth={1.25}
              stroke={edgeStroke(state)}
              initial={reducedMotion ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ transition: 'stroke 240ms var(--ease)' }}
            />
          )
        })}
      </g>

      {/* coordinator */}
      <g>
        <circle cx={COORD.x} cy={COORD.y} r={42} fill="rgba(47,111,237,.10)" stroke="var(--blue-line)" strokeWidth={1} />
        <circle cx={COORD.x} cy={COORD.y} r={30} fill="none" stroke="rgba(47,111,237,.22)" strokeWidth={1} />
        <circle cx={COORD.x} cy={COORD.y} r={12} fill="var(--blue)" filter="url(#softGlow)" />
        <text
          x={COORD.x}
          y={274}
          textAnchor="middle"
          fill="var(--ink)"
          fontFamily="var(--mono)"
          fontSize={11}
          fontWeight={600}
          letterSpacing="0.06em"
        >
          COORDINATOR
        </text>
        <text
          x={COORD.x}
          y={289}
          textAnchor="middle"
          fill="var(--ink-dim)"
          fontFamily="var(--mono)"
          fontSize={10}
          letterSpacing="0.04em"
        >
          ductum core
        </text>
      </g>

      {/* agent nodes */}
      <g>
        {AGENTS.map((a) => {
          const state = states[a.id] ?? 'queued'
          const color = STATE_COLORS[state]
          const isSelected = selectedId === a.id
          return (
            <g
              key={a.id}
              transform={`translate(${a.x},${a.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${a.name} — click to inspect evidence bundle`}
              onClick={() => onSelect(a.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(a.id)
                }
              }}
              style={{ cursor: 'pointer', outline: 'none' }}
            >
              <motion.circle
                r={26}
                fill={nodeBgFill(state)}
                stroke={isSelected ? 'var(--blue)' : 'var(--ink-line-2)'}
                strokeWidth={isSelected ? 1.5 : 1}
                animate={{
                  fill: nodeBgFill(state),
                  stroke: isSelected ? 'var(--blue)' : 'var(--ink-line-2)',
                }}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ transition: 'stroke 240ms var(--ease), fill 240ms var(--ease)' }}
              />
              <motion.circle
                r={6}
                cy={-6}
                fill={color}
                animate={{ fill: color }}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ pointerEvents: 'none', transition: 'fill 240ms var(--ease)' }}
              />
              <text
                textAnchor="middle"
                y={16}
                fill="var(--ink)"
                fontFamily="var(--mono)"
                fontSize={11}
                fontWeight={600}
                letterSpacing="0.04em"
                style={{ pointerEvents: 'none' }}
              >
                {a.name.toUpperCase()}
              </text>
              <text
                textAnchor="middle"
                y={40}
                fill="var(--ink-dim)"
                fontFamily="var(--mono)"
                fontSize={9.5}
                letterSpacing="0.02em"
                style={{ pointerEvents: 'none' }}
              >
                {a.att}
              </text>
              <motion.text
                textAnchor="middle"
                y={-38}
                fontFamily="var(--mono)"
                fontSize={9}
                fontWeight={600}
                letterSpacing="0.08em"
                fill={color}
                animate={{ fill: color }}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                style={{ pointerEvents: 'none', transition: 'fill 240ms var(--ease)' }}
              >
                {stateLabel(a.id, state)}
              </motion.text>
            </g>
          )
        })}
      </g>
    </>
  )
}

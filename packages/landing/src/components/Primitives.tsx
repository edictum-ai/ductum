import { motion } from 'framer-motion'
import { SectionHead } from './SectionHead'

const CELLS = [
  {
    num: '01 · Dispatch',
    title: 'Spec to task to attempt.',
    body: 'Work is a graph, not a script. Ductum resolves specs into tasks, dispatches tasks to agents, and tracks each attempt independently.',
    mono: [
      ['dispatch', 'spec → task → attempt'],
      ['fan-out', 'one coordinator, many agents'],
      ['binding', 'session → run.id'],
    ],
  },
  {
    num: '02 · Record',
    title: 'Every attempt, recorded.',
    body: "Every attempt is recorded, or it didn't happen. State is externalized; the run is the source of truth, not the agent's memory.",
    mono: [
      ['attempt', 'run_id · state · evidence'],
      ['states', 'queued · running · done · failed'],
      ['policy', 'fail-closed by default'],
    ],
  },
  {
    num: '03 · Reproduce',
    title: 'Every run, reproducible.',
    body: 'Determinism is a feature, not a fallback. A run replays from its recorded evidence because the coordinator owns the transitions.',
    mono: [
      ['replay', 'attempt → attempt'],
      ['gates', 'read-before-edit, verify-before-push'],
      ['audit', 'one coordinator beats ten cron jobs'],
    ],
  },
]

export function Primitives() {
  return (
    <section
      id="primitives"
      aria-labelledby="prim-h2"
      style={{ background: 'var(--canvas)', borderBottom: '1px solid var(--ink-line)' }}
    >
      <div className="container">
        <SectionHead
          eyebrow="Primitives"
          title={
            <>
              Not a framework.
              <br />
              Infrastructure.
            </>
          }
        >
          A framework helps you ship a single agent. Ductum is the layer that knows what to do next,
          dispatches it across agents, and keeps the score.
        </SectionHead>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          className="proof-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0,
            padding: '32px 0 88px',
            border: '1px solid var(--ink-line)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--panel)',
          }}
        >
          {CELLS.map((cell, i) => (
            <article
              key={i}
              className="proof-cell"
              style={{
                padding: '30px 26px',
                borderRight: i < CELLS.length - 1 ? '1px solid var(--ink-line)' : 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--blue)',
                }}
              >
                {cell.num}
              </div>
              <h3
                style={{
                  fontFamily: 'var(--display)',
                  fontSize: 22,
                  lineHeight: 1.12,
                  textTransform: 'uppercase',
                  letterSpacing: '-0.01em',
                  color: 'var(--ink)',
                }}
              >
                {cell.title}
              </h3>
              <p style={{ color: 'var(--ink-dim)', fontSize: '14.5px', lineHeight: 1.6 }}>{cell.body}</p>
              <div
                style={{
                  marginTop: 'auto',
                  paddingTop: 16,
                  borderTop: '1px solid var(--ink-line)',
                  fontFamily: 'var(--mono)',
                  fontSize: '11.5px',
                  color: 'var(--ink-dim)',
                  lineHeight: 1.7,
                }}
              >
                {cell.mono.map(([k, v]) => (
                  <div key={k}>
                    <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{k}</b> {v}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .proof-grid { grid-template-columns: 1fr !important; }
          .proof-cell { border-right: none !important; border-bottom: 1px solid var(--ink-line) !important; }
          .proof-cell:last-child { border-bottom: none !important; }
        }
      `}</style>
    </section>
  )
}

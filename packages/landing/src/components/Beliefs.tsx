import { motion } from 'framer-motion'
import { SectionHead } from './SectionHead'

export function Beliefs() {
  return (
    <section
      id="beliefs"
      aria-labelledby="bel-h2"
      style={{ background: 'var(--void)', borderBottom: '1px solid var(--ink-line)' }}
    >
      <div className="container">
        <SectionHead eyebrow="Beliefs" title={<>Two things we believe.</>} />

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          className="beliefs-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            padding: '24px 0 16px',
          }}
        >
          <Belief accent num="Belief 01" text="The work is a graph, not a script." />
          <Belief num="Belief 02" text="Every attempt is recorded, or it didn't happen." />
        </motion.div>

        {/* positioning line — vs cron/Temporal/LangGraph */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            marginTop: 8,
            marginBottom: 72,
            border: '1px solid var(--ink-line)',
            borderRadius: 6,
            background: 'var(--panel-2)',
            padding: '28px 30px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            gap: '12px 18px',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--blue)',
            }}
          >
            positioning
          </span>
          <span
            style={{
              fontFamily: 'var(--display)',
              fontSize: 'clamp(16px, 1.8vw, 20px)',
              textTransform: 'uppercase',
              letterSpacing: '-0.005em',
              lineHeight: 1.3,
              color: 'var(--ink)',
            }}
          >
            <span style={{ color: 'var(--ink-dim)' }}>vs. cron. vs. Temporal. vs. LangGraph.</span>{' '}
            Ductum conducts the <span style={{ color: 'var(--blue)' }}>fleet,</span> not one agent.
          </span>
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .beliefs-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  )
}

function Belief({
  num,
  text,
  accent,
}: {
  num: string
  text: string
  accent?: boolean
}) {
  return (
    <div
      style={{
        border: accent ? '1px solid rgba(47,111,237,.28)' : '1px solid var(--ink-line)',
        borderRadius: 6,
        padding: '30px 28px',
        background: accent ? 'var(--blue-tint)' : 'var(--panel)',
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
        {num}
      </div>
      <div
        style={{
          fontFamily: 'var(--display)',
          fontSize: 'clamp(19px, 2.2vw, 24px)',
          lineHeight: 1.18,
          textTransform: 'uppercase',
          letterSpacing: '-0.008em',
          color: 'var(--ink)',
        }}
      >
        {text}
      </div>
    </div>
  )
}

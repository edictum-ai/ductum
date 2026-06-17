import { motion } from 'framer-motion'

const CLAUSES = ['Every task dispatched.', 'Every attempt recorded.', 'Every run reproducible.']

export function Proof() {
  return (
    <section
      id="proof"
      aria-labelledby="proof-h2"
      style={{ background: 'var(--blue)', color: '#fff', borderBottom: '1px solid var(--ink-line)' }}
    >
      <div className="container" style={{ padding: '88px 0', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div
            id="proof-h2"
            className="eyebrow"
            style={{ color: 'rgba(255,255,255,.7)', marginBottom: 26 }}
          >
            Proof
          </div>
          <div
            style={{
              fontFamily: 'var(--display)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '-0.012em',
              lineHeight: 1.12,
              fontSize: 'clamp(24px, 4.4vw, 48px)',
              color: '#fff',
              maxWidth: '22ch',
              margin: '0 auto',
            }}
          >
            {CLAUSES.map((c, i) => (
              <motion.span
                key={i}
                display="block"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.24,
                  ease: [0.2, 0.8, 0.2, 1],
                  delay: i * 0.09,
                }}
                style={{ display: 'block' }}
              >
                {c}
              </motion.span>
            ))}
          </div>
          <div
            style={{
              marginTop: 36,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,.82)',
            }}
          >
            Deterministic. Fail-closed by default.
          </div>
        </motion.div>
      </div>
    </section>
  )
}

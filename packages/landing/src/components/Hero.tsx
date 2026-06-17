import { motion } from 'framer-motion'
import { HeroCopy } from './HeroCopy'
import { Terminal } from '../fleet/Terminal'

export function Hero() {
  return (
    <section
      aria-labelledby="hero-h1"
      style={{
        position: 'relative',
        background: 'var(--canvas)',
        borderBottom: '1px solid var(--ink-line)',
        overflow: 'hidden',
      }}
    >
      {/* grid texture overlay */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          backgroundImage:
            'linear-gradient(rgba(244,241,234,.022) 1px, transparent 1px), linear-gradient(90deg, rgba(244,241,234,.022) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 35%, #000 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 35%, #000 30%, transparent 80%)',
        }}
      />

      <div
        className="container hero-inner"
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.35fr)',
          gap: 48,
          alignItems: 'center',
          padding: '56px 0 72px',
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <HeroCopy />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1], delay: 0.09 }}
        >
          <Terminal />
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .hero-inner {
            grid-template-columns: 1fr !important;
            gap: 36px !important;
            padding: 40px 0 56px !important;
          }
        }
      `}</style>
    </section>
  )
}

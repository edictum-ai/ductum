import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface SectionHeadProps {
  eyebrow: string
  title: ReactNode
  children?: ReactNode
}

export function SectionHead({ eyebrow, title, children }: SectionHeadProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ padding: '76px 0 12px', maxWidth: 720 }}
    >
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="display" style={{ fontSize: 'clamp(28px, 4vw, 44px)', marginTop: 14 }}>
        {title}
      </h2>
      {children && (
        <p style={{ color: 'var(--ink-dim)', marginTop: 16, fontSize: 16, maxWidth: '60ch' }}>
          {children}
        </p>
      )}
    </motion.div>
  )
}

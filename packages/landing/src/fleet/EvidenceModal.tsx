import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { tokenizeJson, type TokenKind } from './evidence'

interface EvidenceModalProps {
  agentId: string | null
  attempt: string | null
  json: string | null
  onClose: () => void
}

const TOKEN_COLOR: Record<TokenKind, string> = {
  k: 'var(--blue)',
  s: 'var(--done)',
  f: 'var(--failed)',
  d: 'var(--ink-dim)',
  n: 'var(--queued)',
}

export function EvidenceModal({ agentId, attempt, json, onClose }: EvidenceModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (agentId && closeRef.current) {
      closeRef.current.focus()
    }
  }, [agentId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && agentId) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [agentId, onClose])

  const tokens = json ? tokenizeJson(json) : []

  return (
    <AnimatePresence>
      {agentId && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="evTitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={(e: React.MouseEvent<HTMLDivElement>) => {
            if (e.target === e.currentTarget) onClose()
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(12,12,12,.74)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <motion.div
            role="document"
            initial={{ y: 12 }}
            animate={{ y: 0 }}
            exit={{ y: 12 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              width: '100%',
              maxWidth: 560,
              maxHeight: '80vh',
              overflow: 'auto',
              background: 'var(--panel)',
              border: '1px solid var(--ink-line-2)',
              borderRadius: 8,
              boxShadow: '0 30px 80px rgba(0,0,0,.6)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                background: 'var(--panel-2)',
                borderBottom: '1px solid var(--ink-line)',
                fontFamily: 'var(--mono)',
                fontSize: '11.5px',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--ink-dim)',
              }}
            >
              <span id="evTitle">
                <b style={{ color: 'var(--ink)', fontWeight: 600 }}>evidence bundle</b> · attempt{' '}
                <span style={{ color: 'var(--blue)' }}>{attempt}</span>
              </span>
              <button
                ref={closeRef}
                type="button"
                aria-label="Close evidence panel"
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--ink-dim)',
                  fontFamily: 'var(--mono)',
                  fontSize: 16,
                  padding: '0 4px',
                  lineHeight: 1,
                  transition: 'color 90ms var(--ease)',
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = 'var(--ink)')}
                onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => (e.currentTarget.style.color = 'var(--ink-dim)')}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: 18 }}>
              <pre
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '12.5px',
                  lineHeight: 1.65,
                  color: 'var(--ink)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}
              >
                {tokens.map((tok, i) => (
                  <span key={i} style={{ color: TOKEN_COLOR[tok.kind] }}>
                    {tok.text}
                  </span>
                ))}
              </pre>
            </div>

            <div
              style={{
                padding: '12px 18px',
                borderTop: '1px solid var(--ink-line)',
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--ink-dim)',
                letterSpacing: '0.04em',
              }}
            >
              every attempt is recorded — inspect one.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

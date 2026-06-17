import { AnimatePresence, motion } from 'framer-motion'
import { type EventKind, FEED_GLYPHS } from './data'

export interface FeedItem {
  id: number
  kind: EventKind
  text: string
  ts: string
}

interface ActivityFeedProps {
  items: FeedItem[]
  count: number
}

const KIND_COLOR: Record<EventKind, string> = {
  dispatch: 'var(--running)',
  done: 'var(--done)',
  failed: 'var(--failed)',
  queued: 'var(--queued)',
  gate: 'var(--failed)',
  reset: 'var(--running)',
}

export function ActivityFeed({ items, count }: ActivityFeedProps) {
  return (
    <aside
      aria-label="Dispatch activity feed"
      style={{
        background: 'var(--void)',
        minHeight: 420,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--ink-line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'var(--mono)',
          fontSize: '10.5px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-dim)',
        }}
      >
        <span>activity · dispatch.log</span>
        <span>recorded trace</span>
      </div>

      <ul
        aria-live="polite"
        style={{
          listStyle: 'none',
          padding: '6px 0',
          flex: 1,
          fontFamily: 'var(--mono)',
          fontSize: 12,
          overflow: 'hidden',
        }}
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.li
              key={item.id}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              style={{
                padding: '8px 16px',
                borderBottom: '1px solid rgba(244,241,234,.04)',
                display: 'grid',
                gridTemplateColumns: '14px 1fr auto',
                gap: 10,
                alignItems: 'baseline',
                color: 'var(--ink-dim)',
                lineHeight: 1.45,
              }}
            >
              <span aria-hidden="true" style={{ fontWeight: 600, color: KIND_COLOR[item.kind] }}>
                {FEED_GLYPHS[item.kind]}
              </span>
              <span>{item.text}</span>
              <span style={{ color: 'var(--ink-faint)', fontSize: '10.5px' }}>{item.ts}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <div
        style={{
          padding: '11px 16px',
          borderTop: '1px solid var(--ink-line)',
          fontFamily: 'var(--mono)',
          fontSize: 10,
          color: 'var(--ink-dim)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>tail -f</span>
        <span>{count} events</span>
      </div>
    </aside>
  )
}

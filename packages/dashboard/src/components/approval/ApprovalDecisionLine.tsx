import { Mono, ago, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { displayDecisionContext, displayDecisionTitle } from '@/lib/project-display'

export function ApprovalDecisionLine({
  id,
  decision,
  context,
  createdAt,
  last,
}: {
  id: string
  decision: string
  context: string
  createdAt: string
  last: boolean
}) {
  return (
    <div
      style={{
        padding: '12px 0',
        borderTop: last ? 'none' : `1px solid ${tokens.hair}`,
        display: 'flex',
        gap: 16,
        alignItems: 'baseline',
      }}
    >
      <Mono size={11} color={tokens.dim} style={{ width: 72, flexShrink: 0 }}>
        {shortId(id)}
      </Mono>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: tokens.fg, lineHeight: 1.4 }}>
          {displayDecisionTitle({ id, decision })}
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: tokens.mono,
            fontSize: 11,
            color: tokens.faint,
            lineHeight: 1.5,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {displayDecisionContext(context)}
        </div>
      </div>
      <Mono size={11} color={tokens.faint}>
        {ago(createdAt)} ago
      </Mono>
    </div>
  )
}

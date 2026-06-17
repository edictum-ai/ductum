import type { Decision } from '@/api/client'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { shortId } from '@/lib/display'
import { ago } from '@/components/signal'

export function HomepageRecentDecisionsCard({ decisions }: { decisions: Decision[] }) {
  const recent = decisions.slice(0, 5)

  return (
    <Card>
      <CardHeader title="Recent decisions" meta="Past activity" />
      {recent.length === 0 ? (
        <Mono size={12} color={tokens.faint}>— no decisions recorded yet</Mono>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {recent.map((decision, index) => (
            <DecisionLine
              key={decision.id}
              id={decision.id}
              title={decision.decision}
              context={decision.context}
              by={decision.decidedBy}
              date={decision.createdAt}
              last={index === recent.length - 1}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

function DecisionLine({
  id,
  title,
  context,
  by,
  date,
  last,
}: {
  id: string
  title: string
  context: string
  by: string
  date: string
  last: boolean
}) {
  return (
    <div
      style={{
        padding: '14px 0',
        display: 'flex',
        gap: 16,
        borderBottom: last ? 'none' : `1px solid ${tokens.hair}`,
      }}
    >
      <Mono size={11} color={tokens.dim} style={{ width: 72, flexShrink: 0 }}>{shortId(id)}</Mono>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: tokens.sans, fontSize: 14, fontWeight: 500, color: tokens.fg, lineHeight: 1.35 }}>
          {title}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: 12.5,
            color: tokens.mid,
            lineHeight: 1.5,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {context}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <Mono size={11} color={tokens.dim}>by {by}</Mono>
        <Mono size={11} color={tokens.faint} style={{ display: 'block', marginTop: 2 }}>
          {ago(date)} ago
        </Mono>
      </div>
    </div>
  )
}

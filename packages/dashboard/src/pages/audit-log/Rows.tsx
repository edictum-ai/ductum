import { Link } from 'react-router-dom'

import type { AuditLogEntry } from '@/api/client'
import { Btn, Caps, Card, Dot, Mono, tokens, toneColor } from '@/components/signal'
import {
  auditTarget,
  auditTone,
  displayAuditText,
  eventLabel,
  formatAuditTime,
  metadataRows,
  statusLabel,
} from './helpers'

export function AuditLogRows({
  items,
  nextCursor,
  onNextPage,
}: {
  items: AuditLogEntry[]
  nextCursor: string | null
  onNextPage: (cursor: string) => void
}) {
  if (items.length === 0) {
    return (
      <Card>
        <Caps>No matching audit events</Caps>
        <p style={{ color: tokens.mid, fontSize: 14, margin: '8px 0 0' }}>
          Change the filters or clear them to inspect the global audit trail.
        </p>
      </Card>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {items.map((item) => <AuditLogRow key={item.id} item={item} />)}
      {nextCursor != null && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <Btn onClick={() => onNextPage(nextCursor)}>Next page</Btn>
        </div>
      )}
    </div>
  )
}

function AuditLogRow({ item }: { item: AuditLogEntry }) {
  const target = auditTarget(item)
  const metadata = metadataRows(item.metadata)
  const tone = auditTone(item.status)
  return (
    <article
      style={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: 10,
        background: tokens.canvas,
        padding: 16,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'start' }}>
        <Dot color={tone === 'mid' ? tokens.mid : toneColor(tone)} size={8} style={{ marginTop: 5 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Caps color={tokens.accent}>{eventLabel(item.eventType)}</Caps>
            <Mono size={10.5} color={tone === 'mid' ? tokens.mid : toneColor(tone)}>{statusLabel(item.status)}</Mono>
          </div>
          <h2
            style={{
              margin: '6px 0 0',
              color: tokens.strong,
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.3,
              overflowWrap: 'anywhere',
            }}
          >
            {displayAuditText(item.title)}
          </h2>
          <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 5 }}>
            {item.actor ?? 'actor unknown'} · {target.href == null ? target.label : <Link to={target.href} style={{ color: tokens.mid }}>{target.label}</Link>}
          </Mono>
          {item.summary != null && item.summary.trim() !== '' && (
            <p style={{ color: tokens.mid, fontSize: 13, lineHeight: 1.5, margin: '8px 0 0', overflowWrap: 'anywhere' }}>
              {displayAuditText(item.summary)}
            </p>
          )}
        </div>
        <Mono size={11} color={tokens.faint}>{formatAuditTime(item.occurredAt)}</Mono>
      </div>
      {metadata.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', color: tokens.dim, fontFamily: tokens.mono, fontSize: 11 }}>
            Metadata
          </summary>
          <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) 1fr', gap: '6px 10px', margin: '10px 0 0' }}>
            {metadata.map(([key, value]) => (
              <AuditMetadata key={key} name={key} value={value} />
            ))}
          </dl>
        </details>
      )}
    </article>
  )
}

function AuditMetadata({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt><Mono size={10.5} color={tokens.faint}>{name}</Mono></dt>
      <dd style={{ margin: 0, minWidth: 0 }}>
        <Mono size={10.5} color={tokens.dim} style={{ overflowWrap: 'anywhere' }}>{value}</Mono>
      </dd>
    </>
  )
}

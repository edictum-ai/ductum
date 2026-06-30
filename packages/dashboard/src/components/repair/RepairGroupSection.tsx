import { Link } from 'react-router-dom'

import { Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import type { RepairGroup, RepairItem, RepairSeverity, RepairTarget } from '@/lib/repair'

export function RepairGroupSection({ group }: { group: RepairGroup }) {
  const count = group.items.length
  const blockers = group.items.filter((item) => item.severity === 'blocker').length
  const warnings = count - blockers
  return (
    <Card>
      <CardHeader
        title={group.label}
        meta={`${group.blocks} · ${severitySummary(blockers, warnings)}`}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {group.items.map((item) => (
          <RepairItemRow key={item.id} item={item} />
        ))}
      </div>
    </Card>
  )
}

function severitySummary(blockers: number, warnings: number): string {
  const parts = [
    blockers > 0 ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : null,
    warnings > 0 ? `${warnings} fix soon` : null,
  ].filter(Boolean)
  return parts.length === 0 ? '0 items' : parts.join(' · ')
}

function RepairItemRow({ item }: { item: RepairItem }) {
  const color = severityColor(item.severity)
  return (
    <div
      style={{
        border: `1px solid ${tokens.hair}`,
        borderLeft: `2px solid ${color}`,
        borderRadius: 8,
        padding: '14px 16px',
        background: tokens.sunken,
        display: 'grid',
        gap: 9,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <Dot color={color} size={7} />
        <span style={{ fontSize: 14, fontWeight: 600, color: tokens.strong, minWidth: 0 }}>{item.title}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <SeverityTag severity={item.severity} />
        </span>
      </div>

      {item.target != null && <TargetLine target={item.target} />}

      <div style={{ fontSize: 13, color: tokens.mid, lineHeight: 1.5 }}>{item.reason}</div>

      {(item.record != null || item.field != null) && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', overflowWrap: 'anywhere' }}>
          {[item.record, item.field != null ? `field: ${item.field}` : null].filter(Boolean).join(' · ')}
        </Mono>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: tokens.info, fontSize: 12, flexShrink: 0 }}>→</span>
        <span style={{ fontSize: 13, color: tokens.fg, lineHeight: 1.5 }}>{item.suggestedAction}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 2 }}>
        {item.href != null && item.linkLabel != null && (
          <Link
            to={item.href}
            style={{
              fontFamily: tokens.sans,
              fontSize: 12.5,
              fontWeight: 500,
              color: tokens.info,
              textDecoration: 'none',
            }}
          >
            {item.linkLabel} →
          </Link>
        )}
        {item.issueCode != null && <TechnicalDetails issueCode={item.issueCode} />}
      </div>
    </div>
  )
}

function TargetLine({ target }: { target: RepairTarget }) {
  const parts: string[] = []
  if (target.project != null) parts.push(target.project)
  if (target.spec != null) parts.push(target.spec)
  if (target.task != null) parts.push(target.task)
  if (target.attempt != null) parts.push(`Attempt ${target.attempt}`)
  if (parts.length === 0) return null
  return (
    <Mono size={11} color={tokens.dim} style={{ display: 'block', overflowWrap: 'anywhere' }}>
      {parts.join(' · ')}
    </Mono>
  )
}

function SeverityTag({ severity }: { severity: RepairSeverity }) {
  const color = severityColor(severity)
  const label = severity === 'blocker' ? 'blocker' : 'fix soon'
  return (
    <span
      style={{
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
        color,
        borderRadius: 6,
        padding: '1px 8px',
        fontFamily: tokens.mono,
        fontSize: 10,
        fontWeight: 650,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

/**
 * Raw issue code is advanced diagnostic data — kept available but never the
 * primary label. Rendered inside the code disclosure so an exact-match query
 * on the bare enum does not treat it as a heading.
 */
function TechnicalDetails({ issueCode }: { issueCode: string }) {
  return (
    <details style={{ marginLeft: 'auto' }}>
      <summary
        style={{
          cursor: 'pointer',
          listStyle: 'none',
          fontFamily: tokens.mono,
          fontSize: 10.5,
          color: tokens.faint,
        }}
      >
        Technical details
      </summary>
      <Mono size={11} color={tokens.dim} style={{ display: 'block', marginTop: 6, overflowWrap: 'anywhere' }}>
        issue code: {issueCode}
      </Mono>
    </details>
  )
}

function severityColor(severity: RepairSeverity): string {
  return severity === 'blocker' ? tokens.err : tokens.warn
}

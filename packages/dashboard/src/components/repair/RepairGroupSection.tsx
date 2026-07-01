import { Copy } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Btn, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import type { RepairGroup, RepairItem, RepairSeverity, RepairTarget } from '@/lib/repair'

interface RepairItemCluster {
  id: string
  title: string
  reason: string
  suggestedAction: string
  severity: RepairSeverity
  items: RepairItem[]
}

export function RepairGroupSection({ group }: { group: RepairGroup }) {
  const count = group.items.length
  const blockers = group.items.filter((item) => item.severity === 'blocker').length
  const warnings = count - blockers
  const clusters = clusterRepairItems(group.items)
  return (
    <Card>
      <CardHeader
        title={group.label}
        meta={`${group.blocks} · ${severitySummary(blockers, warnings)}`}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {clusters.map((cluster) => (
          <RepairItemClusterRow key={cluster.id} cluster={cluster} />
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

function RepairItemClusterRow({ cluster }: { cluster: RepairItemCluster }) {
  const color = severityColor(cluster.severity)
  const command = commandFromAction(cluster.suggestedAction)
  const hasUnresolvedPlaceholder = hasPlaceholder(cluster.suggestedAction)
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
        <span style={{ fontSize: 14, fontWeight: 600, color: tokens.strong, minWidth: 0 }}>{cluster.title}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <SeverityTag severity={cluster.severity} />
        </span>
      </div>

      <div style={{ fontSize: 13, color: tokens.mid, lineHeight: 1.5 }}>{cluster.reason}</div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: tokens.info, fontSize: 12, flexShrink: 0 }}>→</span>
        {command != null ? (
          <CommandAction command={command} />
        ) : (
          <span style={{ fontSize: 13, color: tokens.fg, lineHeight: 1.5 }}>
            {hasUnresolvedPlaceholder ? 'Action needs a concrete record value before it can be copied.' : cluster.suggestedAction}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {cluster.items.length > 1 && (
          <Mono size={10.5} color={tokens.dim}>
            {cluster.items.length} affected records
          </Mono>
        )}
        {cluster.items.map((item) => <AffectedRecord key={item.id} item={item} />)}
      </div>
    </div>
  )
}

function AffectedRecord({ item }: { item: RepairItem }) {
  return (
    <div
      style={{
        borderTop: `1px solid ${tokens.hair}`,
        paddingTop: 8,
        display: 'grid',
        gap: 7,
      }}
    >
      {item.target != null && <TargetLine target={item.target} />}
      {(item.record != null || item.field != null) && (
        <Mono size={11} color={tokens.dim} style={{ display: 'block', overflowWrap: 'anywhere' }}>
          {[item.record, item.field != null ? `field: ${item.field}` : null].filter(Boolean).join(' · ')}
        </Mono>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
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

function CommandAction({ command }: { command: string }) {
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0, flex: 1 }}>
      <pre
        style={{
          margin: 0,
          padding: '8px 10px',
          border: `1px solid ${tokens.rule}`,
          borderRadius: 7,
          background: tokens.raised,
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        <code style={{ fontFamily: tokens.mono, fontSize: 12, color: tokens.fg }}>{command}</code>
      </pre>
      <Btn
        small
        ghost
        aria-label="Copy recovery command"
        title="Copy recovery command"
        onClick={() => {
          void navigator.clipboard?.writeText(command)
        }}
        style={{ justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        Copy
      </Btn>
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

function clusterRepairItems(items: RepairItem[]): RepairItemCluster[] {
  const clusters = new Map<string, RepairItemCluster>()
  for (const item of items) {
    const key = clusterKey(item)
    const existing = clusters.get(key)
    if (existing == null) {
      clusters.set(key, {
        id: key,
        title: item.title,
        reason: item.reason,
        suggestedAction: item.suggestedAction,
        severity: item.severity,
        items: [item],
      })
    } else {
      existing.items.push(item)
    }
  }
  return Array.from(clusters.values()).sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === 'blocker' ? -1 : 1
    return left.title.localeCompare(right.title)
  })
}

function clusterKey(item: RepairItem): string {
  return [
    item.severity,
    normalize(item.title),
    normalize(item.reason),
    normalize(item.suggestedAction),
  ].join('|')
}

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function commandFromAction(action: string): string | null {
  const trimmed = action.trim()
  if (hasPlaceholder(trimmed)) return null
  return trimmed.startsWith('ductum ') ? trimmed : null
}

function hasPlaceholder(value: string): boolean {
  return /<[^>\s]+>/.test(value)
}

import { Copy } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Btn, Card, CardHeader, Dot, Mono, tokens } from '@/components/signal'
import {
  clusterRepairItems,
  commandFromAction,
  hasPlaceholder,
  type RepairItemCluster,
} from '@/lib/repair-cluster'
import type { RepairGroup, RepairItem, RepairSeverity, RepairTarget } from '@/lib/repair'

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

      <ClusterActionLine cluster={cluster} />

      <div style={{ display: 'grid', gap: 8 }}>
        {cluster.items.length > 1 && (
          <Mono size={10.5} color={tokens.dim}>
            {cluster.items.length} affected records
          </Mono>
        )}
        {cluster.items.map((item) => <AffectedRecord key={item.id} item={item} showCommand={cluster.hasPerRecordCommands} />)}
      </div>
    </div>
  )
}

/**
 * The cluster header answers "what do I do next?" without forcing the operator
 * to open the transcript. When every affected record shares one literal
 * command, we render it here as a copyable code block. When the command varies
 * per record (different task id / branch / commit), we render the prose label
 * here and let each AffectedRecord show its own copyable command below.
 */
function ClusterActionLine({ cluster }: { cluster: RepairItemCluster }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ color: tokens.info, fontSize: 12, flexShrink: 0 }}>→</span>
      {cluster.sharedCommand != null ? (
        <CommandAction command={cluster.sharedCommand} />
      ) : (
        <span style={{ fontSize: 13, color: tokens.fg, lineHeight: 1.5 }}>
          {cluster.actionLabel}
        </span>
      )}
    </div>
  )
}

function AffectedRecord({ item, showCommand }: { item: RepairItem; showCommand: boolean }) {
  const command = showCommand ? commandFromAction(item.suggestedAction) : null
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
      {command != null && <CommandAction command={command} />}
      {showCommand && command == null && (
        <NoCopyableAction action={item.suggestedAction} />
      )}
    </div>
  )
}

function NoCopyableAction({ action }: { action: string }) {
  if (hasPlaceholder(action)) {
    return (
      <Mono size={11} color={tokens.faint} style={{ lineHeight: 1.5 }}>
        Action needs a concrete record value before it can be copied.
      </Mono>
    )
  }
  return (
    <Mono size={11} color={tokens.dim} style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>
      {action}
    </Mono>
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

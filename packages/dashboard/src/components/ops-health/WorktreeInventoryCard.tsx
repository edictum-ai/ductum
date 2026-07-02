import { useState, type ReactNode } from 'react'

import type { OpsWorktreeInventory } from '@/api/client'
import { Card, CardHeader, Mono, tokens } from '@/components/signal'
import { CopyButton } from '@/components/CopyButton'
import { formatBytes } from '@/lib/ops-health-format'

export function WorktreeInventoryCard({ inventory }: { inventory: OpsWorktreeInventory }) {
  const [showPaths, setShowPaths] = useState(false)
  const hasError = inventory.error != null
  const hasEntries = inventory.entries.length > 0
  return (
    <Card>
      <CardHeader
        title="Worktree inventory"
        meta={inventory.basePath == null ? 'no base path' : inventory.basePath}
        action={
          hasEntries ? (
            <button
              type="button"
              onClick={() => setShowPaths((value) => !value)}
              style={linkStyle}
            >
              {showPaths ? 'Hide paths' : 'Full paths'}
            </button>
          ) : null
        }
      />
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Stat label="State" value={stateLabel(inventory)} tone={hasError ? 'warn' : 'ok'} />
          <Stat label="Directories" value={String(inventory.directoryCount)} />
          <Stat
            label="Disk usage"
            value={inventory.measurable ? formatBytes(inventory.totalBytes) : 'not measurable'}
            tone={inventory.measurable ? 'default' : 'warn'}
          />
        </div>
        {hasError && (
          <Banner tone="warn" message={inventory.error!} />
        )}
        {!hasError && !hasEntries && (
          <Banner tone="info" message="No worktree directories exist under the configured base path yet." />
        )}
        {hasEntries && (
          <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'auto', borderTop: `1px solid ${tokens.hair}` }}>
            <div style={{ display: 'grid', gap: 0 }}>
            <Row header>
              <Cell>Project</Cell>
              <Cell>Task dir</Cell>
              <Cell>Short id</Cell>
              <Cell right>Disk</Cell>
              <Cell right>Modified</Cell>
              <Cell right>Status</Cell>
            </Row>
            {inventory.entries.map((entry) => (
              <Row key={entry.path}>
                <Cell><Mono size={11}>{entry.project}</Mono></Cell>
                <Cell>
                  <Mono size={11} color={tokens.mid}>
                    {showPaths ? entry.path : entry.taskDir}
                  </Mono>
                  {showPaths && <CopyButton value={entry.path} className="shrink-0" />}
                </Cell>
                <Cell><Mono size={11} color={tokens.dim}>{entry.shortId ?? '—'}</Mono></Cell>
                <Cell right><Mono size={11}>{entry.bytes == null ? '—' : formatBytes(entry.bytes)}</Mono></Cell>
                <Cell right><Mono size={11} color={tokens.dim}>{entry.mtimeMs == null ? '—' : new Date(entry.mtimeMs).toISOString().slice(0, 19) + 'Z'}</Mono></Cell>
                <Cell right>{statusBadge(entry.exists, entry.accessible)}</Cell>
              </Row>
            ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}

function stateLabel(inventory: OpsWorktreeInventory): string {
  if (inventory.error != null) return 'unavailable'
  if (!inventory.enabled) return 'disabled'
  if (inventory.directoryCount === 0) return 'empty'
  return inventory.measurable ? 'measured' : 'present'
}

function statusBadge(exists: boolean, accessible: boolean): ReactNode {
  if (!exists) return <Badge tone="err" label="missing" />
  if (!accessible) return <Badge tone="warn" label="inaccessible" />
  return <Badge tone="ok" label="ok" />
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'ok' | 'warn' | 'err' }) {
  const color = tone === 'ok' ? tokens.ok : tone === 'warn' ? tokens.warn : tone === 'err' ? tokens.err : tokens.strong
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: tokens.dim }}>{label}</span>
      <Mono size={12} color={color as string}>{value}</Mono>
    </div>
  )
}

function Banner({ tone, message }: { tone: 'info' | 'warn'; message: string }) {
  const color = tone === 'warn' ? tokens.warn : tokens.info
  return (
    <div style={{ padding: '8px 10px', border: `1px solid ${color}`, borderRadius: 6, color, fontSize: 12 }}>
      {message}
    </div>
  )
}

function Badge({ tone, label }: { tone: 'ok' | 'warn' | 'err'; label: string }) {
  const color = tone === 'ok' ? tokens.ok : tone === 'warn' ? tokens.warn : tokens.err
  return (
    <span style={{ fontSize: 10, padding: '1px 6px', border: `1px solid ${color}`, color: color as string, borderRadius: 4, fontFamily: tokens.mono }}>
      {label}
    </span>
  )
}

function Row({ children, header = false }: { children: React.ReactNode; header?: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(90px, 0.9fr) minmax(180px, 2fr) 76px 90px 145px 86px',
      gap: 8,
      minWidth: 760,
      padding: '6px 10px',
      borderBottom: `1px solid ${tokens.hair}`,
      alignItems: 'center',
      background: header ? tokens.sunken : 'transparent',
      fontSize: 11,
      color: header ? tokens.dim : tokens.mid,
      textTransform: header ? 'uppercase' : 'none',
      letterSpacing: header ? 0.5 : 'normal',
    }}>
      {children}
    </div>
  )
}

function Cell({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <div style={{
      minWidth: 0,
      textAlign: right ? 'right' : 'left',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      justifyContent: right ? 'flex-end' : 'flex-start',
      overflowWrap: 'anywhere',
    }}>
      {children}
    </div>
  )
}

const linkStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: tokens.accent,
  fontSize: 12,
  cursor: 'pointer',
  padding: 0,
}

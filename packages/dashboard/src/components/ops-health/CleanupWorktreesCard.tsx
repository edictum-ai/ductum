import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { OpsWorktreeInventory } from '@/api/client'
import { useCleanupWorktreesGuarded } from '@/api/hooks'
import { Card, CardHeader, tokens } from '@/components/signal'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/ops-health-format'

export function CleanupWorktreesCard({ inventory }: { inventory: OpsWorktreeInventory }) {
  const [confirmed, setConfirmed] = useState(false)
  const mutation = useCleanupWorktreesGuarded()
  const result = mutation.data
  const outcome = result?.outcome

  return (
    <Card>
      <CardHeader
        title="Cleanup worktrees"
        meta={`${inventory.directoryCount} directories · ${inventory.measurable ? formatBytes(inventory.totalBytes) : 'not measurable'}`}
      />
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11, color: tokens.mid }}>
          <StatusItem label="scope" value="inactive only" />
          <StatusItem label="protected" value="active, paused, checkpoints" />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: tokens.mid }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            aria-label="Confirm destructive cleanup"
            data-testid="cleanup-confirm-checkbox"
          />
          <span>
            I understand this deletes inactive worktree directories from disk.
          </span>
        </label>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={!confirmed || mutation.isPending}
            onClick={() => mutation.mutate({ confirm: true })}
            data-testid="cleanup-confirm-button"
          >
            {mutation.isPending ? 'Running cleanup…' : 'Run guarded cleanup'}
          </Button>
          {mutation.isError && (
            <ResultLine
              tone="err"
              icon={<XCircle size={14} />}
              text={`Request failed: ${(mutation.error as Error)?.message ?? 'unknown error'}`}
            />
          )}
          {outcome === 'success' && (
            <ResultLine
              tone="ok"
              icon={<CheckCircle2 size={14} />}
              text={result!.reason ?? `Removed ${result!.removed} inactive worktree directory(ies).`}
            />
          )}
          {outcome === 'unavailable' && (
            <ResultLine
              tone="warn"
              icon={<AlertTriangle size={14} />}
              text={result!.reason ?? 'Cleanup primitive is unavailable.'}
            />
          )}
          {outcome === 'error' && (
            <ResultLine
              tone="err"
              icon={<XCircle size={14} />}
              text={result!.reason ?? 'Cleanup failed.'}
            />
          )}
        </div>
        <p style={{ margin: 0, fontSize: 11, color: tokens.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={11} />
          Outcomes are also written to the audit log as <code>ops.cleanup_worktrees</code>.
        </p>
      </div>
    </Card>
  )
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      <span style={{ color: tokens.dim, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</span>
      <span>{value}</span>
    </span>
  )
}

function ResultLine({
  tone,
  icon,
  text,
}: {
  tone: 'ok' | 'warn' | 'err'
  icon: ReactNode
  text: string
}) {
  const color = tone === 'ok' ? tokens.ok : tone === 'warn' ? tokens.warn : tokens.err
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: color as string }} data-testid="cleanup-result">
      {icon}
      <span>{text}</span>
    </span>
  )
}

import type { ReactNode } from 'react'

import { JsonBlock } from '@/components/JsonBlock'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type EvidencePayload = Record<string, unknown>
type EvidenceRenderer = (payload: EvidencePayload) => ReactNode

const TYPED_EVIDENCE_RENDERERS: Record<string, EvidenceRenderer> = {
  'worktree.snapshot': renderWorktreeSnapshot,
  'operator.cancel': renderOperatorCancel,
}

export function TypedEvidenceRenderer({ type, payload }: { type: string; payload: EvidencePayload }) {
  const kind = typeof payload.kind === 'string' ? payload.kind : null
  const renderer = kind == null ? null : TYPED_EVIDENCE_RENDERERS[kind]
  if (renderer == null) return <JsonBlock content={JSON.stringify(payload)} label={`${type} payload`} />
  return <>{renderer(payload)}</>
}

function renderWorktreeSnapshot(payload: EvidencePayload) {
  const diffStat = readRecord(payload.diffStat)
  const verifyOutput = readRecord(payload.verifyOutput)
  const exitCode = readNumber(verifyOutput?.exitCode)
  const passed = exitCode === 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border bg-sky-950/50 font-mono text-[10px] text-sky-300 border-sky-800/50">
          worktree.snapshot
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">{readString(payload.branch, 'unknown')}</span>
        <span className="font-mono text-[11px] text-muted-foreground/70">{readString(payload.commitSha, 'unknown').slice(0, 12)}</span>
      </div>
      <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
        <span>{readNumber(diffStat?.filesChanged)} files</span>
        <span className="text-emerald-300">+{readNumber(diffStat?.insertions)}</span>
        <span className="text-red-300">-{readNumber(diffStat?.deletions)}</span>
        <Badge variant="outline" className={cn('border font-mono text-[10px]', passed ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40' : 'bg-red-950/60 text-red-300 border-red-800/40')}>
          verify {passed ? 'PASS' : 'FAIL'}
        </Badge>
      </div>
      <code className="block break-words font-mono text-[11px] text-muted-foreground/70">{readString(verifyOutput?.command, '(none)')}</code>
      <pre className="max-h-40 overflow-auto rounded border border-border/30 bg-background/70 p-2 font-mono text-[11px] text-muted-foreground">
        {readString(verifyOutput?.tail, '')}
      </pre>
    </div>
  )
}

function renderOperatorCancel(payload: EvidencePayload) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border bg-zinc-950/50 font-mono text-[10px] text-zinc-300 border-zinc-800/50">
          operator.cancel
        </Badge>
        <span className="font-mono text-[11px] text-muted-foreground">
          {payload.worktreePreserved === true ? 'worktree preserved' : 'worktree removed'}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">{readString(payload.reason, 'cancelled')}</div>
      {payload.cleanupAt != null && (
        <code className="block font-mono text-[11px] text-muted-foreground/70">
          cleanupAt {readString(payload.cleanupAt, '')}
        </code>
      )}
    </div>
  )
}

function readRecord(value: unknown): EvidencePayload | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as EvidencePayload : null
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

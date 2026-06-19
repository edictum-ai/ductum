import {
  CheckCircle,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileDiff,
  GitBranch,
  ShieldCheck,
  TestTube,
} from 'lucide-react'
import { useState } from 'react'

import type { Evidence, EnrichedRun } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { latchTone } from '@/lib/stage-display'
import { toneTextClass } from '@/components/signal'
import { cn, formatDuration } from '@/lib/utils'

const SUMMARY_PREVIEW_LEN = 200

// ─── Extractors ───────────────────────────────────────────────

/** Derive test evidence summary from evidence list. */
function extractTestSummary(evidence: Evidence[]): {
  total: number | null
  passed: number | null
  failed: number
  isPass: boolean
  suite?: string
} | null {
  for (let i = evidence.length - 1; i >= 0; i--) {
    const ev = evidence[i]!
    if (ev.type !== 'test') continue
    const p = ev.payload
    const passed = typeof p.tests_passed === 'number'
      ? p.tests_passed
      : typeof p.passed === 'number' ? p.passed : null
    const failed = typeof p.tests_failed === 'number'
      ? p.tests_failed
      : typeof p.failed === 'number' ? p.failed : 0
    const total = typeof p.total === 'number'
      ? p.total
      : passed != null ? passed + Number(failed) : null
    const isPass = p.result === 'pass' || p.passed === true
      || (failed === 0 && passed != null && passed > 0)
    return {
      total,
      passed,
      failed,
      isPass,
      suite: typeof p.suite === 'string' ? p.suite : undefined,
    }
  }
  return null
}

// ─── Sub-components ───────────────────────────────────────────

/** Breadcrumb: project › spec › task */
function TaskBreadcrumb({
  projectName,
  specName,
  taskName,
}: {
  projectName: string
  specName: string
  taskName: string
}) {
  return (
    <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
      <span className="truncate max-w-[100px]" title={projectName}>{projectName}</span>
      <ChevronRight className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[100px]" title={specName}>{specName}</span>
      <ChevronRight className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[120px] font-medium text-foreground/80" title={taskName}>{taskName}</span>
    </div>
  )
}

/** CI or review status as a colored Badge. */
function StatusBadge({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const cls = toneTextClass(latchTone(value))
  return (
    <Badge variant="outline" className="font-mono text-[10px] border-border/40">
      <span className="text-muted-foreground/60">{label}:</span>{' '}
      <span className={cls}>{value}</span>
    </Badge>
  )
}

/** Test evidence rendered inline. */
function TestEvidenceInline({ evidence }: { evidence: Evidence[] }) {
  const test = extractTestSummary(evidence)
  if (test == null) return null
  return (
    <div className="flex items-center gap-1.5">
      <TestTube className="h-3 w-3 text-violet-400/70" />
      <Badge
        variant="outline"
        className={cn(
          'border font-mono text-[10px]',
          test.isPass
            ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800/30'
            : 'bg-red-950/40 text-red-300 border-red-800/30',
        )}
      >
        {test.isPass ? 'PASS' : 'FAIL'}
      </Badge>
      {test.total != null && (
        <span className="font-mono text-[11px] text-muted-foreground/80">
          {test.total} test{test.total !== 1 ? 's' : ''},{' '}
          {test.isPass ? 'all pass' : `${test.passed ?? 0} passed, ${test.failed} failed`}
        </span>
      )}
      {test.suite && (
        <span className="font-mono text-[10px] text-muted-foreground/40">({test.suite})</span>
      )}
    </div>
  )
}

/** Completion summary preview with expand. */
function SummaryPreview({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > SUMMARY_PREVIEW_LEN
  const display = isLong && !expanded
    ? text.slice(0, SUMMARY_PREVIEW_LEN) + '…'
    : text

  return (
    <div className="space-y-1.5 rounded-md border border-border/20 bg-muted/10 p-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-500/70">
          Agent Summary
        </span>
        {isLong && (
          <button
            type="button"
            className="font-mono text-[10px] text-primary/60 hover:text-primary"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Collapse' : `Expand (${text.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/75">{display}</p>
    </div>
  )
}

/** Reject confirmation dialog. */
function RejectDialog({
  runId,
  isPending,
  onReject,
}: {
  runId: string
  isPending: boolean
  onReject: (runId: string, reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border-red-800/40 text-red-400 hover:bg-red-950/40"
        >
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject attempt</DialogTitle>
          <DialogDescription>
            Provide a reason for rejecting this attempt.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          placeholder="Rejection reason..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || isPending}
            onClick={() => {
              onReject(runId, reason)
              setOpen(false)
              setReason('')
            }}
          >
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main Card ────────────────────────────────────────────────

interface ApprovalCardProps {
  run: EnrichedRun
  evidence: Evidence[]
  completionSummary: string | null
  changedFiles: number | null
  approving: boolean
  rejecting: boolean
  exiting: boolean
  onApprove: (runId: string) => void
  onReject: (runId: string, reason: string) => void
}

export function ApprovalCard({
  run,
  evidence,
  completionSummary,
  changedFiles,
  approving,
  rejecting,
  exiting,
  onApprove,
  onReject,
}: ApprovalCardProps) {
  return (
    <Card
      className={cn(
        'border-l-4 border-l-primary/60 border-border/40 bg-card/60 transition-all duration-500 ease-in-out',
        exiting && 'opacity-0 -translate-x-4 scale-[0.98] pointer-events-none',
      )}
    >
      <CardContent className="space-y-3 p-4">
        {/* ── Header: task breadcrumb + wait time ── */}
        <div className="flex items-start justify-between gap-3">
          <TaskBreadcrumb
            projectName={run.projectName}
            specName={run.specName}
            taskName={run.taskName}
          />
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
            waiting {formatDuration(run.createdAt)}
          </span>
        </div>

        {/* ── Agent info ── */}
        <div className="flex items-center gap-2">
          <Cpu className="h-3.5 w-3.5 text-muted-foreground/60" />
          <span className="text-sm font-medium">{run.agentName ?? 'Agent'}</span>
          {run.agentModel && (
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {run.agentModel}
            </span>
          )}
        </div>

        {/* ── PR / Branch / Commit ── */}
        <div className="flex flex-wrap items-center gap-2">
          {run.prUrl && (
            <a
              href={run.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 font-mono text-xs text-primary hover:underline"
            >
              PR #{run.prNumber ?? '?'}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
          {run.branch && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
              <GitBranch className="h-3 w-3" />
              {run.branch}
            </span>
          )}
          {run.commitSha && (
            <span className="font-mono text-[10px] text-muted-foreground/40">
              {run.commitSha.slice(0, 8)}
            </span>
          )}
        </div>

        {/* ── Status badges: CI + Review ── */}
        <div className="flex flex-wrap items-center gap-2">
          {run.ciStatus && <StatusBadge label="CI" value={run.ciStatus} />}
          {run.reviewStatus && (
            <StatusBadge label="Review" value={run.reviewStatus} />
          )}
        </div>

        {/* ── Evidence strip: tests + changed files ── */}
        {(evidence.length > 0 || changedFiles != null) && (
          <div className="flex flex-wrap items-center gap-3">
            <TestEvidenceInline evidence={evidence} />
            {changedFiles != null && (
              <div className="flex items-center gap-1">
                <FileDiff className="h-3 w-3 text-cyan-400/70" />
                <span className="font-mono text-[11px] text-muted-foreground/80">
                  {changedFiles} file{changedFiles !== 1 ? 's' : ''} changed
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Completion summary preview ── */}
        {completionSummary && (
          <SummaryPreview text={completionSummary} />
        )}

        {/* ── Actions ── */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            disabled={approving || exiting}
            onClick={() => onApprove(run.id)}
          >
            <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
            Approve
          </Button>
          <RejectDialog
            runId={run.id}
            isPending={rejecting || exiting}
            onReject={onReject}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Empty state ──────────────────────────────────────────────

export function ApprovalQueueEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="grid-bg mb-6 flex h-20 w-20 items-center justify-center rounded-xl border border-border/30 bg-card/40">
        <ShieldCheck className="h-8 w-8 text-muted-foreground/30" />
      </div>
      <h3 className="mb-1 text-lg font-semibold tracking-tight">All clear</h3>
      <p className="text-sm text-muted-foreground">No attempts waiting for approval.</p>
    </div>
  )
}

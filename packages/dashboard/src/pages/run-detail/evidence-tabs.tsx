import type { Decision, Evidence, GateEvaluation, RunStageTransition, RunUpdate } from '@/api/client'
import { JsonBlock } from '@/components/JsonBlock'
import { TypedEvidenceRenderer } from '@/components/evidence/TypedEvidenceRenderer'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { displayDecisionContext, displayDecisionTitle, displayStoredName } from '@/lib/project-display'
import { redactSensitiveText } from '@/lib/run-activity-labels'
import { evidenceTone, gateTone, stageLabel, stageTone } from '@/lib/stage-display'
import { toneBadgeClass, toneColor } from '@/components/signal'
import { cn, formatTime } from '@/lib/utils'

function formatEvidencePayload(type: string, payload: Record<string, unknown>) {
  if (typeof payload.kind === 'string' && payload.kind.includes('.')) {
    return <TypedEvidenceRenderer type={type} payload={payload} />
  }
  if (type !== 'test') return <JsonBlock content={JSON.stringify(payload)} label={`${type} payload`} />
  const p = payload
  const testsPassed = typeof p.tests_passed === 'number' ? p.tests_passed : (typeof p.passed === 'number' ? p.passed : null)
  const testsFailed = typeof p.tests_failed === 'number' ? p.tests_failed : (typeof p.failed === 'number' ? p.failed : 0)
  const total = typeof p.total === 'number' ? p.total : (testsPassed != null ? testsPassed + Number(testsFailed) : null)
  const isPass = p.result === 'pass' || p.passed === true || (testsFailed === 0 && testsPassed != null && testsPassed > 0)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn('border font-mono text-[10px]', isPass ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/40' : 'bg-red-950/60 text-red-300 border-red-800/40')}>
          {isPass ? 'PASS' : 'FAIL'}
        </Badge>
        {total != null && <span className="font-mono text-xs">{String(total)} tests, {String(testsPassed)} passed, {String(testsFailed)} failed</span>}
      </div>
      {typeof p.suite === 'string' && <p className="font-mono text-[11px] text-muted-foreground break-words">{p.suite}</p>}
      {typeof p.command === 'string' && <code className="block break-words font-mono text-[11px] text-muted-foreground/70">{p.command}</code>}
      <JsonBlock content={JSON.stringify(payload)} label="full payload" />
    </div>
  )
}

export function EvidenceTab({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) return <p className="text-sm text-muted-foreground">No evidence attached yet.</p>
  return (
    <div className="space-y-2">
      {evidence.map((ev) => (
        <div key={ev.id} className="rounded-md border border-border/30 bg-muted/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="secondary" className={cn('border font-mono text-[10px]', toneBadgeClass(evidenceTone(ev.type)))}>{ev.type}</Badge>
            <span className="font-mono text-[10px] text-muted-foreground/50">{formatTime(ev.createdAt)}</span>
          </div>
          {formatEvidencePayload(ev.type, ev.payload)}
        </div>
      ))}
    </div>
  )
}

export function TransitionsTab({ transitions }: { transitions: RunStageTransition[] }) {
  if (transitions.length === 0) return <p className="text-sm text-muted-foreground">No stage transitions recorded.</p>
  return (
    <div className="space-y-2">
      {transitions.map((t, i) => {
        const isSameStage = t.fromStage === t.toStage
        return (
          <div key={t.id} className="relative flex gap-3 rounded-md border border-border/30 bg-muted/10 p-3">
            <div className="flex flex-col items-center">
              <span className="h-2.5 w-2.5 rounded-full border-2 bg-background" style={{ borderColor: toneColor(stageTone(t.toStage)) }} />
              {i < transitions.length - 1 && <span className="mt-1 h-full w-px bg-border/50" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground/50">{formatTime(t.createdAt)}</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(stageTone(t.fromStage)))}>{stageLabel(t.fromStage)}</Badge>
                  {!isSameStage && (
                    <>
                      <span className="text-muted-foreground/40">→</span>
                      <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(stageTone(t.toStage)))}>{stageLabel(t.toStage)}</Badge>
                    </>
                  )}
                  {isSameStage && <span className="font-mono text-[10px] text-muted-foreground/40">(reset)</span>}
                </div>
              </div>
              {t.reason && <p className="text-[12px] leading-relaxed text-muted-foreground">{t.reason}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function GatesTab({ gates }: { gates: GateEvaluation[] }) {
  if (gates.length === 0) return <p className="text-sm text-muted-foreground">No gate evaluations yet.</p>
  const allowed = gates.filter((g) => g.result === 'allowed' && !g.observed).length
  const blocked = gates.filter((g) => g.result === 'blocked' && !g.observed).length
  const observed = gates.filter((g) => g.observed).length
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(gateTone('allowed')))}>{allowed} allowed</Badge>
        {blocked > 0 && <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(gateTone('blocked')))}>{blocked} blocked</Badge>}
        {observed > 0 && <Badge variant="outline" className="border-dashed border-amber-500/40 font-mono text-[10px] text-amber-400/80" title="Observer mode — rule reported what it WOULD have blocked, but the agent was allowed through.">{observed} would-have-blocked</Badge>}
        <span className="font-mono text-[10px] text-muted-foreground/50">{gates.length} total</span>
      </div>
      <GateTable gates={gates} />
    </div>
  )
}

function GateTable({ gates }: { gates: GateEvaluation[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-border/30">
      <Table>
        <TableHeader><TableRow className="border-border/20 hover:bg-transparent">
          <TableHead className="text-[11px]">Time</TableHead><TableHead className="text-[11px]">Gate</TableHead>
          <TableHead className="text-[11px]">Target</TableHead><TableHead className="text-[11px]">Result</TableHead>
          <TableHead className="text-[11px]">Reason</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {gates.map((g) => (
            <TableRow key={g.id} className={cn('border-border/20', g.observed && 'border-dashed border-amber-500/30 text-muted-foreground/60')}>
              <TableCell><span className="font-mono text-[10px] text-muted-foreground/70">{formatTime(g.createdAt)}</span></TableCell>
              <TableCell><span className="font-mono text-[11px]">{g.gateType}</span></TableCell>
              <TableCell><span className="font-mono text-[11px] text-muted-foreground">{g.target}</span></TableCell>
              <TableCell>
                <Badge variant="outline" className={cn('border font-mono text-[10px]', toneBadgeClass(gateTone(g.result)), g.observed && 'border-dashed opacity-70')} title={g.observed ? 'Observer mode — dry-run result' : undefined}>
                  {g.observed ? `${g.result} (observed)` : g.result}
                </Badge>
              </TableCell>
              <TableCell><span className="font-mono text-[11px] text-muted-foreground">{g.reason == null || g.reason === '' ? 'No reason recorded' : g.reason}</span></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function DecisionsTab({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) return <p className="text-sm text-muted-foreground">No decisions recorded.</p>
  return (
    <div className="space-y-2">
      {decisions.map((d) => (
        <div key={d.id} className="rounded-md border border-border/30 bg-muted/20 p-3">
          <p className="mb-1 text-sm font-medium">{displayDecisionTitle(d)}</p>
          <p className="mb-2 text-xs text-muted-foreground">{displayDecisionContext(d.context)}</p>
          {d.alternatives && d.alternatives.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {d.alternatives.map((alt, i) => (
                <Badge key={i} variant="outline" className="border-border/30 font-mono text-[10px] text-muted-foreground">
                  {displayStoredName(alt, 'Alternative')}
                </Badge>
              ))}
            </div>
          )}
          <p className="font-mono text-[10px] text-muted-foreground/50">by {d.decidedBy}</p>
        </div>
      ))}
    </div>
  )
}

export function UpdatesTab({ updates }: { updates: RunUpdate[] }) {
  if (updates.length === 0) return <p className="text-sm text-muted-foreground">No progress updates.</p>
  return (
    <div className="space-y-4">
      {updates.map((u, i) => (
        <div key={u.id} className="relative rounded-md border border-border/30 bg-muted/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', i === updates.length - 1 ? 'bg-primary' : 'bg-muted-foreground/30')} />
            <span className="font-mono text-[10px] text-muted-foreground/50">{formatTime(u.createdAt)}</span>
            {i === updates.length - 1 && <span className="font-mono text-[10px] text-primary/60">latest</span>}
          </div>
          <FormatUpdateMessage message={u.message} />
        </div>
      ))}
    </div>
  )
}

function FormatUpdateMessage({ message }: { message: string }) {
  const lines = redactSensitiveText(message).split('\n')
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        const listMatch = trimmed.match(/^(\d+)\.\s+(.*)$/)
        if (listMatch) {
          const parts = listMatch[2]!.split(' — ')
          return (
            <div key={i} className="flex items-start gap-2 pl-2 text-[13px]">
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">{listMatch[1]}.</span>
              <div>
                {parts.length > 1 ? (
                  <>
                    <code className="font-mono text-[12px] text-primary/80">{parts[0]}</code>
                    <span className="text-muted-foreground"> — {parts.slice(1).join(' — ')}</span>
                  </>
                ) : <span className="text-muted-foreground">{parts[0]}</span>}
              </div>
            </div>
          )
        }
        if (trimmed.startsWith('- ')) {
          return <div key={i} className="flex items-start gap-2 pl-2 text-[13px]"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/30" /><span className="text-muted-foreground">{trimmed.slice(2)}</span></div>
        }
        return <p key={i} className={cn('text-[13px]', i === 0 ? 'font-medium text-foreground/90' : 'text-muted-foreground')}>{trimmed}</p>
      })}
    </div>
  )
}

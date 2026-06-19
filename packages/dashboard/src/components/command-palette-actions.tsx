import { Activity, BookOpen, Bot, CheckCircle2, Cpu, FileText, FolderKanban, KeyRound, ListChecks, Play, RotateCcw, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'

import type { EnrichedRun, OperatorBrief, RepairReport, SearchResult } from '@/api/client'
import { buildRunSections } from '@/components/homepage/RunFeed'
import { runDisplayStatus, runHref, runStatusLabel } from '@/lib/run-presentation'

export interface PaletteItem {
  id: string
  name: string
  subtitle: string
  url: string
  label: string
  icon: ReactNode
}

export function resultIcon(type: SearchResult['type']) {
  switch (type) {
    case 'run': return <Cpu className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    case 'task': return <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    case 'spec': return <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    case 'project': return <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    case 'agent': return <Bot className="h-4 w-4 shrink-0 text-muted-foreground/60" />
    case 'decision': return <FileText className="h-4 w-4 shrink-0 text-muted-foreground/60" />
  }
}

export const TYPE_LABEL: Record<SearchResult['type'], string> = {
  run: 'attempt', task: 'task', spec: 'spec', project: 'project', agent: 'agent', decision: 'decision',
}

export function buildOperatorPaletteActions({
  runs,
  brief,
  repair,
}: {
  runs: EnrichedRun[]
  brief?: OperatorBrief
  repair?: RepairReport
}): PaletteItem[] {
  const sections = buildRunSections(runs)
  const readyTasks = brief?.queue?.readyTasks ?? 0
  const actions: PaletteItem[] = []

  const attention = sections.needsAttention[0]
  if (attention != null) {
    actions.push({
      id: `attention-${attention.id}`,
      name: `Inspect blocked attempt: ${attention.taskName}`,
      subtitle: `${attemptContext(attention)} · ${attentionSignal(attention)}`,
      url: runHref(attention),
      label: `retry · ${sections.needsAttention.length}`,
      icon: <RotateCcw className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
    })
  }

  const approval = sections.awaitingApproval[0]
  if (approval != null) {
    actions.push({
      id: `approval-${approval.id}`,
      name: `Review approval: ${approval.taskName}`,
      subtitle: `${attemptContext(approval)} · approve or reject after evidence review`,
      url: runHref(approval),
      label: `approve · ${sections.awaitingApproval.length}`,
      icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
    })
  }

  if (readyTasks > 0) {
    actions.push({
      id: 'dispatch',
      name: readyTasks === 1 ? 'Dispatch ready task' : `Dispatch ${readyTasks} ready tasks`,
      subtitle: 'Open Ready to dispatch; choose an agent and start the attempt.',
      url: '/activity',
      label: `dispatch · ${readyTasks}`,
      icon: <Play className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
    })
  }

  const running = sections.running[0]
  if (running != null) {
    actions.push({
      id: `watch-${running.id}`,
      name: `Watch running attempt: ${running.taskName}`,
      subtitle: attemptContext(running),
      url: runHref(running),
      label: `watch · ${sections.running.length}`,
      icon: <Activity className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
    })
  }

  const repairTotal = repair?.summary.total ?? 0
  if (repairTotal > 0) {
    const blockerCount = repair?.summary.blockers ?? 0
    actions.push({
      id: 'repair',
      name: blockerCount > 0 ? `Repair ${blockerCount} factory blockers` : `Repair ${repairTotal} factory issues`,
      subtitle: 'Open Repair for the current blocker list and suggested next action.',
      url: '/repair',
      label: `repair · ${repairTotal}`,
      icon: <Wrench className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
    })
  }

  actions.push({
    id: 'activity',
    name: 'Open Factory Activity',
    subtitle: activitySummary({
      needsAttention: sections.needsAttention.length,
      approvals: sections.awaitingApproval.length,
      readyTasks,
      running: sections.running.length,
    }),
    url: '/activity',
    label: 'open',
    icon: <ListChecks className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
  })
  actions.push({
    id: 'api-access',
    name: 'Dashboard session',
    subtitle: 'Reconnect or clear this browser session.',
    url: '/settings#api-access',
    label: 'session',
    icon: <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground/60" />,
  })

  return actions
}

function attemptContext(run: EnrichedRun): string {
  return `${run.projectName} · ${run.specName} · ${runStatusLabel(run).toLowerCase()}`
}

function attentionSignal(run: EnrichedRun): string {
  const status = runDisplayStatus(run)
  if (status === 'failed' || status === 'stalled') return 'inspect logs before retry'
  return 'inspect integrity evidence'
}

function activitySummary(input: { needsAttention: number; approvals: number; readyTasks: number; running: number }): string {
  const parts = [
    countPart(input.needsAttention, 'needs attention'),
    countPart(input.approvals, 'approval'),
    countPart(input.readyTasks, 'ready'),
    countPart(input.running, 'running'),
  ].filter((part): part is string => part != null)
  return parts.length === 0 ? 'Live attempts, ready queue, and attention items.' : parts.join(' · ')
}

function countPart(count: number, label: string): string | null {
  if (count === 0) return null
  return `${count} ${label}${count === 1 || label === 'ready' || label === 'needs attention' || label === 'running' ? '' : 's'}`
}

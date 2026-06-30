import type { ProjectRun, Spec, Task } from '@/api/client'
import { costCoverageRollup, summarizeCostCoverage } from '@/lib/cost-coverage'
import { runDisplayStatus } from '@/lib/run-presentation'

export function ProjectSpecNarrative({
  spec,
  tasks,
  runs,
}: {
  spec: Spec
  tasks: Task[]
  runs: ProjectRun[]
}) {
  const coverage = summarizeCostCoverage(runs)
  return (
    <div className="grid gap-2 border-b border-border/20 px-4 py-3 text-xs md:grid-cols-3">
      <NarrativeCell label="Happened" value={happenedText(runs)} />
      <NarrativeCell label="Cost" value={costCoverageRollup(coverage)} />
      <NarrativeCell label="Next" value={nextActionText(spec, tasks, runs)} />
    </div>
  )
}

function NarrativeCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50">{label}</div>
      <div className="mt-1 leading-5 text-foreground/85">{value}</div>
    </div>
  )
}

function happenedText(runs: ProjectRun[]): string {
  if (runs.length === 0) return 'No attempts have run yet.'
  const failed = runs.filter((run) => {
    const status = runDisplayStatus(run)
    return status === 'failed' || status === 'stalled'
  }).length
  const running = runs.filter((run) => runDisplayStatus(run) === 'running').length
  const awaiting = runs.filter((run) => runDisplayStatus(run) === 'awaiting_approval').length
  const done = runs.filter((run) => runDisplayStatus(run) === 'done').length
  if (failed > 0) return `${failed} failed or stalled attempt${failed === 1 ? '' : 's'} ${failed === 1 ? 'needs' : 'need'} inspection.`
  if (running > 0) return `${running} attempt${running === 1 ? '' : 's'} running now.`
  if (awaiting > 0) return `${awaiting} attempt${awaiting === 1 ? '' : 's'} awaiting approval.`
  if (done > 0) return `${done} attempt${done === 1 ? '' : 's'} completed.`
  return `${runs.length} attempt${runs.length === 1 ? '' : 's'} recorded.`
}

function nextActionText(spec: Spec, tasks: Task[], runs: ProjectRun[]): string {
  if (runs.some((run) => {
    const status = runDisplayStatus(run)
    return status === 'failed' || status === 'stalled'
  })) {
    return 'Open the latest failed attempt, inspect logs, then retry only after the blocker is understood.'
  }
  if (runs.some((run) => runDisplayStatus(run) === 'awaiting_approval')) {
    return 'Review evidence and approve or deny through Ductum.'
  }
  if (runs.some((run) => runDisplayStatus(run) === 'running')) {
    return 'Watch the active attempt until it reaches review, approval, or failure.'
  }
  if (tasks.some((task) => task.status === 'ready')) return 'Dispatch the ready task when the assigned agent is correct.'
  if (spec.status === 'done') return 'No operator action is required.'
  return 'Open the spec before dispatching to confirm tasks and acceptance criteria.'
}

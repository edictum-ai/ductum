/**
 * Homepage hierarchy: Project > Spec > Lineage > Attempts.
 *
 * The old homepage RunFeed dumped every attempt flat under running and
 * action-needed headers. That hides the structure of what's
 * actually being worked on — the operator can't tell which spec is
 * active, which review belongs to which impl, or what stage the
 * lineage is at without clicking through.
 *
 * SpecGroups inverts the layout: every active spec gets its own
 * section, lineage tasks (review-X, fix-X) nest under their impl
 * task, and the impl task is the visual anchor of each lineage row.
 * Reviews and fixes show inline as small badges next to the impl row
 * — the operator can scan the list and immediately see "P4 has 1
 * review running, P3 has 2 fix attempts failed".
 */

import { ChevronDown, ChevronRight, Eye, GitBranch, Hammer, Wrench } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { EnrichedRun, Task } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { StageBar } from '@/components/homepage/StageBar'
import { TaskDAG } from '@/components/TaskDAG'
import {
  DISPLAY_STATUS_CLASSES,
} from '@/lib/derived-status'
import { shortId } from '@/lib/display'
import { costCoverageIssues, costCoverageRollup, costCoverageValue, summarizeCostCoverage } from '@/lib/cost-coverage'
import { runCost, runDisplayStatus, runHref, runStatusLabel } from '@/lib/run-presentation'
import {
  parseTaskKind,
  TASK_KIND_BADGE_CLASSES,
  type TaskKind,
} from '@/lib/task-kind'
import { cn, timeAgo } from '@/lib/utils'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

function lastActivityAt(run: EnrichedRun): string {
  return run.lastHeartbeat ?? run.updatedAt
}

interface LineageGroup {
  /** Lineage root name = the impl task name. */
  rootName: string
  /** All runs across the impl + review + fix tasks for this lineage. */
  runs: EnrichedRun[]
  /** Most recent activity timestamp across the lineage. */
  lastActivity: string
  /** Cumulative cost across every run in the lineage. */
  totalCost: number
  /** True if any run is currently making progress. */
  hasLive: boolean
  /** True if any run is awaiting human approval. */
  hasAwaiting: boolean
  /** True if every run that exists is failed/stalled. */
  allFailed: boolean
}

interface SpecGroup {
  projectName: string
  specName: string
  lineages: LineageGroup[]
  liveLineageCount: number
  awaitingCount: number
  failedCount: number
  totalCost: number
  lastActivity: string
}

/**
 * Bucket EnrichedRun[] into SpecGroup[] sorted by most recent activity.
 * Within each spec, lineages are sorted by their own lastActivity.
 */
export function buildSpecGroups(runs: EnrichedRun[]): SpecGroup[] {
  // Two-level map: specKey → lineageRoot → runs
  const specToLineage = new Map<string, Map<string, EnrichedRun[]>>()
  for (const run of runs) {
    const specKey = `${run.projectName}/${run.specName}`
    const { originalName } = parseTaskKind(run.taskName)
    let lineageMap = specToLineage.get(specKey)
    if (lineageMap == null) {
      lineageMap = new Map()
      specToLineage.set(specKey, lineageMap)
    }
    const list = lineageMap.get(originalName) ?? []
    list.push(run)
    lineageMap.set(originalName, list)
  }

  const groups: SpecGroup[] = []
  for (const [specKey, lineageMap] of specToLineage) {
    const [projectName, specName] = specKey.split('/') as [string, string]
    const lineages: LineageGroup[] = []
    for (const [rootName, lineageRuns] of lineageMap) {
      lineageRuns.sort((a, b) => new Date(lastActivityAt(b)).getTime() - new Date(lastActivityAt(a)).getTime())
      const lastActivity = lineageRuns[0]?.lastHeartbeat ?? lineageRuns[0]?.updatedAt ?? ''
      const totalCost = lineageRuns.reduce((sum, r) => sum + runCost(r).usd, 0)
      const statuses = lineageRuns.map(runDisplayStatus)
      lineages.push({
        rootName,
        runs: lineageRuns,
        lastActivity,
        totalCost,
        hasLive: statuses.some((s) => s === 'running'),
        hasAwaiting: statuses.some((s) => s === 'awaiting_approval'),
        allFailed: statuses.length > 0 && statuses.every((s) => s === 'failed' || s === 'stalled'),
      })
    }
    lineages.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
    const liveLineageCount = lineages.filter((l) => l.hasLive).length
    const awaitingCount = lineages.filter((l) => l.hasAwaiting).length
    const failedCount = lineages.filter((l) => l.allFailed).length
    const totalCost = lineages.reduce((sum, l) => sum + l.totalCost, 0)
    const lastActivity = lineages[0]?.lastActivity ?? ''
    groups.push({
      projectName,
      specName,
      lineages,
      liveLineageCount,
      awaitingCount,
      failedCount,
      totalCost,
      lastActivity,
    })
  }
  groups.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
  return groups
}

const KIND_ICON = {
  impl: Hammer,
  review: Eye,
  fix: Wrench,
} as const

const KIND_ICON_COLOR: Record<TaskKind, string> = {
  impl: 'text-blue-400',
  review: 'text-purple-400',
  fix: 'text-amber-400',
}

/**
 * One spec card: header with spec identity + counts, then a stack of
 * lineage rows. Each lineage row has the impl task as the primary
 * label and review/fix follow-ups as badges next to it. A toggle in
 * the header expands the inline TaskDAG preview so the operator can
 * see the lineage shape without navigating into the spec page.
 */
export function SpecGroupCard({ group }: { group: SpecGroup }) {
  const navigate = useNavigate()
  const [graphOpen, setGraphOpen] = useState(false)
  const groupCost = groupCostSummary(group)
  return (
    <div className="rounded-lg border border-border/40 bg-card/40">
      <div className="flex items-center gap-3 border-b border-border/30 px-4 py-3.5">
        <button
          type="button"
          className="min-w-0 flex-1 rounded text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => navigate(`/${enc(group.projectName)}/${enc(group.specName)}`)}
          aria-label={`Open ${group.projectName} ${group.specName}`}
        >
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
              {group.projectName}
            </span>
            <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-base font-semibold tracking-tight">{group.specName}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
            <span>{group.lineages.length} task{group.lineages.length === 1 ? '' : 's'}</span>
            {group.liveLineageCount > 0 && (
              <span className="text-blue-300">· {group.liveLineageCount} running</span>
            )}
            {group.awaitingCount > 0 && (
              <span className="text-amber-300">· {group.awaitingCount} awaiting approval</span>
            )}
            {group.failedCount > 0 && (
              <span className="text-amber-300">· {group.failedCount} failed history</span>
            )}
          </div>
        </button>
        <button
          type="button"
          className={cn(
            'flex shrink-0 items-center gap-1 rounded border px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors',
            graphOpen
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
              : 'border-border/40 text-muted-foreground/60 hover:border-border/60 hover:text-foreground',
          )}
          onClick={() => setGraphOpen((v) => !v)}
          aria-pressed={graphOpen}
          title="Toggle inline task graph"
        >
          <GitBranch className="h-3 w-3" />
          graph
        </button>
        <div className="shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
          <div>{groupCost.label}</div>
          {groupCost.issues && <div className="text-amber-300/70">{groupCost.issues}</div>}
          <div className="text-muted-foreground/40">{timeAgo(group.lastActivity)}</div>
        </div>
      </div>
      {graphOpen && (
        <div className="border-b border-border/30 bg-muted/[0.03] p-3">
          <TaskDAG
            tasks={synthesizeTasksFromLineages(group)}
            dependencies={[]}
            projectName={group.projectName}
            specName={group.specName}
            compact
          />
        </div>
      )}
      <div className="divide-y divide-border/20">
        {group.lineages.map((lineage) => (
          <LineageRow key={`${group.projectName}/${group.specName}/${lineage.rootName}`} group={group} lineage={lineage} />
        ))}
      </div>
    </div>
  )
}

/**
 * The TaskDAG component normally takes Task[] from /api/specs/:id/tasks,
 * but on the homepage we only have EnrichedRun[]. Synthesize a
 * minimal Task[] from the runs in each lineage so the inline graph
 * preview can render without an extra fetch. Status falls back to
 * 'active' for any lineage with at least one live run, 'failed' if
 * everything terminated, 'done' if anything reached done.
 */
function synthesizeTasksFromLineages(group: SpecGroup): Task[] {
  const tasksByName = new Map<string, Task>()
  for (const lineage of group.lineages) {
    for (const run of lineage.runs) {
      if (tasksByName.has(run.taskName)) continue
      const status = run.stage === 'done'
        ? 'done'
        : run.terminalState != null
          ? 'failed'
          : 'active'
      tasksByName.set(run.taskName, {
        id: run.taskId,
        specId: 'synthetic',
        name: run.taskName,
        prompt: '',
        repos: [],
        assignedAgentId: run.agentId,
        requiredRole: null,
        complexity: null,
        status,
        verification: [],
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      } as Task)
    }
  }
  return [...tasksByName.values()]
}

/**
 * One lineage within a spec. Shows the impl task name as the anchor,
 * with role-coded badges (R1, F1, etc.) for each review/fix child.
 *
 * Clicking the row toggles an inline expansion that lists every
 * round + every run in the lineage with stage, agent, cost, duration.
 * The chevron icon on the left flips. The "open task page" affordance
 * lives on the right rail (the cost/time block), so the row click is
 * always "expand" — operators don't navigate by accident when they
 * just want a closer look.
 */
function LineageRow({ group, lineage }: { group: SpecGroup; lineage: LineageGroup }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  // Map kind → most recent run of that kind so the row can show one
  // badge per role with its current status.
  const byKind = new Map<TaskKind, EnrichedRun[]>()
  for (const r of lineage.runs) {
    const parsed = parseTaskKind(r.taskName)
    const list = byKind.get(parsed.kind) ?? []
    list.push(r)
    byKind.set(parsed.kind, list)
  }
  const implRun = byKind.get('impl')?.[0]
  const reviewRuns = (byKind.get('review') ?? []).sort((a, b) => parseTaskKind(b.taskName).round - parseTaskKind(a.taskName).round)
  const fixRuns = (byKind.get('fix') ?? []).sort((a, b) => parseTaskKind(b.taskName).round - parseTaskKind(a.taskName).round)
  const latestReview = reviewRuns[0]
  const latestFix = fixRuns[0]

  // The "primary" attempt we deep-link to: the latest non-terminal attempt
  // first, then awaiting-approval, then the impl run.
  const primary =
    [...lineage.runs].sort((a, b) => {
      const sa = runDisplayStatus(a)
      const sb = runDisplayStatus(b)
      const order = { running: 0, awaiting_review: 1, awaiting_approval: 2, done: 3, failed: 4, stalled: 4, frozen: 4, quarantined: 4, cancelled: 5, paused: 5 } as const
      return order[sa] - order[sb]
    })[0] ?? implRun ?? lineage.runs[0]

  const primaryStatus = primary != null ? runDisplayStatus(primary) : 'failed'
  const url = primary != null ? runHref(primary) : `/${enc(group.projectName)}/${enc(group.specName)}`
  const cost = lineageCostSummary(lineage)

  // All runs sorted into chronological lineage order:
  // impl → review-r1 → fix-r1 → review-r2 → fix-r2 → ...
  const sortedRuns = [...lineage.runs].sort((a, b) => {
    const pa = parseTaskKind(a.taskName)
    const pb = parseTaskKind(b.taskName)
    if (pa.round !== pb.round) return pa.round - pb.round
    const order = { impl: 0, review: 1, fix: 2 }
    return order[pa.kind] - order[pb.kind]
  })

  return (
    <div>
      <div className="flex items-start gap-2 px-4 py-3 transition-colors hover:bg-accent/30">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${lineage.rootName}`}
        >
          {expanded
            ? <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            : <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
          <Hammer className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', KIND_ICON_COLOR.impl)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-normal">{lineage.rootName}</span>
              <Badge
                variant="outline"
                className={cn('border font-mono text-[9px]', DISPLAY_STATUS_CLASSES[primaryStatus])}
              >
                {primary != null ? runStatusLabel(primary) : 'Failed'}
              </Badge>
              {/* Role chips: each shows the latest round + status */}
              {latestReview && <RoleChip run={latestReview} kind="review" />}
              {latestFix && <RoleChip run={latestFix} kind="fix" />}
              {reviewRuns.length > 1 && (
                <span className="font-mono text-[9px] text-muted-foreground/40">+{reviewRuns.length - 1}r</span>
              )}
              {fixRuns.length > 1 && (
                <span className="font-mono text-[9px] text-muted-foreground/40">+{fixRuns.length - 1}f</span>
              )}
            </div>
            <div className="mt-2 max-w-5xl">
              <StageBar runs={lineage.runs} compact showLabel />
            </div>
            {primary?.failReason && (
              <p className="mt-1 truncate text-[11px] text-red-400/80">{primary.failReason}</p>
            )}
          </div>
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-1 text-right font-mono text-[10px] text-muted-foreground/60 transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          title="Open primary attempt"
          onClick={() => navigate(url)}
          aria-label={`Open primary attempt for ${lineage.rootName}`}
        >
          <div>{cost.label}</div>
          {cost.issues && <div className="text-amber-300/70">{cost.issues}</div>}
          <div className="text-muted-foreground/40">{timeAgo(lineage.lastActivity)}</div>
          <div className="mt-0.5 text-blue-400/70">open →</div>
        </button>
      </div>
      {expanded && (
        <div className="space-y-px border-t border-border/20 bg-muted/[0.03] px-3 py-2 pl-10">
          {sortedRuns.map((run) => (
            <ExpandedRunRow
              key={run.id}
              run={run}
              onNavigate={navigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const KIND_ROW_BG: Record<TaskKind, string> = {
  impl: 'border-l-blue-500/40',
  review: 'border-l-purple-500/40',
  fix: 'border-l-amber-500/40',
}

/**
 * One run row inside an expanded lineage. Shows the role badge,
 * status, agent, cost, last activity, and (when failed) the
 * fail reason. Clicking opens the run page.
 */
function ExpandedRunRow({
  run,
  onNavigate,
}: {
  run: EnrichedRun
  onNavigate: (path: string) => void
}) {
  const parsed = parseTaskKind(run.taskName)
  const status = runDisplayStatus(run)
  const Icon = KIND_ICON[parsed.kind]
  const url = runHref(run)
  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-center gap-2 rounded border-l-2 bg-muted/10 px-2 py-1.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        KIND_ROW_BG[parsed.kind],
      )}
      onClick={() => onNavigate(url)}
    >
      <Icon className={cn('h-3 w-3 shrink-0', KIND_ICON_COLOR[parsed.kind])} />
      <span
        className={cn(
          'rounded border px-1 py-0 font-mono text-[8px] uppercase',
          TASK_KIND_BADGE_CLASSES[parsed.kind],
        )}
      >
        {parsed.roleCode}
      </span>
      <Badge variant="outline" className={cn('border font-mono text-[8px] uppercase', DISPLAY_STATUS_CLASSES[status])}>
        {runStatusLabel(run)}
      </Badge>
      <span className="truncate font-mono text-[10px] text-muted-foreground/80">{run.taskName}</span>
      <span className="font-mono text-[9px] text-muted-foreground/50">{run.agentName}</span>
      <span className="font-mono text-[9px] text-muted-foreground/40">{shortId(run.id)}</span>
      <div className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[9px] text-muted-foreground/60">
        <span>{runCost(run).label}</span>
        <span className="text-muted-foreground/30">·</span>
        <span>{timeAgo(run.lastHeartbeat ?? run.updatedAt)}</span>
      </div>
    </button>
  )
}

function RoleChip({ run, kind }: { run: EnrichedRun; kind: TaskKind }) {
  const Icon = KIND_ICON[kind]
  const status = runDisplayStatus(run)
  const round = parseTaskKind(run.taskName).round
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px]',
        TASK_KIND_BADGE_CLASSES[kind],
      )}
      title={`${kind} round ${round} — ${runStatusLabel(run)}`}
    >
      <Icon className="h-2.5 w-2.5" />
      {kind === 'review' ? `R${round}` : `F${round}`}
      <span className="opacity-70">·</span>
      <span className="opacity-90">{runStatusLabel(run)}</span>
    </span>
  )
}

function lineageCostSummary(lineage: LineageGroup): { label: string; issues: string } {
  const coverage = summarizeCostCoverage(lineage.runs)
  return {
    label: coverage.trackedUsd > 0 ? costCoverageRollup(coverage) : costCoverageValue(coverage),
    issues: coverage.trackedUsd > 0 ? '' : costCoverageIssues(coverage),
  }
}

function groupCostSummary(group: SpecGroup): { label: string; issues: string } {
  const coverage = summarizeCostCoverage(group.lineages.flatMap((lineage) => lineage.runs))
  return {
    label: coverage.trackedUsd > 0 ? costCoverageRollup(coverage) : costCoverageValue(coverage),
    issues: coverage.trackedUsd > 0 ? '' : costCoverageIssues(coverage),
  }
}

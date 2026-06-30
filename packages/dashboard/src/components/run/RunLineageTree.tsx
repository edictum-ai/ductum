/**
 * Run lineage tree — visualizes the impl/review/fix run hierarchy
 * within one task lineage. Used by TaskDetail (replaces the flat run
 * list) and RunDetail (as a context panel showing where the current
 * run sits in its lineage).
 *
 * The factory's fix-loop creates new tasks (review-X, fix-X-r1,
 * review-X-r2, ...) under the same spec, with each new run pointing
 * its `parentRunId` at the run that triggered it. The result is a
 * tree:
 *
 *   impl run
 *   ├─ review run (round 1)
 *   │   └─ fix run (round 1)         ← parentRunId = review run
 *   │       └─ review run (round 2)  ← parentRunId = fix run
 *   │           └─ fix run (round 2)
 *   └─ ...
 *
 * Walking the tree by parentRunId means an operator can see, for any
 * run, the full conversation: which review found what, which fix
 * addressed it, which re-review caught the next issue, and so on —
 * all in a single nested view that mirrors the factory's actual
 * decision flow.
 */

import { CheckCircle2, ChevronDown, ChevronRight, Eye, Hammer, Wrench, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { EnrichedRun } from '@/api/client'
import { useAllRuns } from '@/api/hooks'
import { Badge } from '@/components/ui/badge'
import {
  DISPLAY_STATUS_CLASSES,
} from '@/lib/derived-status'
import { shortId } from '@/lib/display'
import { runCost, runDisplayStatus, runHref, runStatusLabel } from '@/lib/run-presentation'
import {
  parseTaskKind,
  TASK_KIND_BADGE_CLASSES,
  type TaskKind,
} from '@/lib/task-kind'
import { displayRunTaskName } from '@/lib/project-display'
import { cn, timeAgo } from '@/lib/utils'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

interface TreeNode {
  run: EnrichedRun
  children: TreeNode[]
}

const KIND_ICON = {
  impl: Hammer,
  review: Eye,
  fix: Wrench,
} as const

const KIND_COLOR: Record<TaskKind, string> = {
  impl: 'text-blue-400',
  review: 'text-purple-400',
  fix: 'text-amber-400',
}

const KIND_BORDER: Record<TaskKind, string> = {
  impl: 'border-l-blue-500/50',
  review: 'border-l-purple-500/40',
  fix: 'border-l-amber-500/40',
}

/**
 * Build a parent → children tree from a flat list of lineage runs.
 * Roots are runs with no parent in the list (typically the impl run).
 * If multiple roots exist (orphans), they all return.
 */
function buildRunTree(runs: EnrichedRun[]): TreeNode[] {
  const byId = new Map(runs.map((r) => [r.id, r]))
  const childrenOf = new Map<string, EnrichedRun[]>()
  const roots: EnrichedRun[] = []

  for (const run of runs) {
    const parentId = run.parentRunId
    if (parentId == null || !byId.has(parentId)) {
      roots.push(run)
      continue
    }
    const list = childrenOf.get(parentId) ?? []
    list.push(run)
    childrenOf.set(parentId, list)
  }

  function build(run: EnrichedRun): TreeNode {
    const children = (childrenOf.get(run.id) ?? [])
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(build)
    return { run, children }
  }

  return roots
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map(build)
}

/**
 * Filter the global EnrichedRun list down to one lineage. The
 * lineage is identified by:
 *   - same project
 *   - same spec
 *   - same lineage root (parseTaskKind(taskName).originalName)
 */
function selectLineageRuns(runs: EnrichedRun[], projectName: string, specName: string, lineageRoot: string): EnrichedRun[] {
  return runs.filter(
    (r) =>
      r.projectName === projectName &&
      r.specName === specName &&
      parseTaskKind(r.taskName).originalName === lineageRoot,
  )
}

interface Props {
  projectName: string
  specName: string
  /** The impl task name = lineage root. */
  lineageRoot: string
  /** Optional: highlight this run id (the current page's run). */
  highlightRunId?: string
}

export function RunLineageTree({ projectName, specName, lineageRoot, highlightRunId }: Props) {
  const navigate = useNavigate()
  const { data: allRuns = [] } = useAllRuns({ limit: '500' })

  const tree = useMemo(() => {
    const lineageRuns = selectLineageRuns(allRuns, projectName, specName, lineageRoot)
    return buildRunTree(lineageRuns)
  }, [allRuns, projectName, specName, lineageRoot])

  if (tree.length === 0) {
    return <p className="text-sm text-muted-foreground">No attempts in this lineage yet.</p>
  }

  return (
    <div className="space-y-1">
      {tree.map((node) => (
        <RunNode
          key={node.run.id}
          node={node}
          depth={0}
          projectName={projectName}
          specName={specName}
          highlightRunId={highlightRunId}
          onNavigate={navigate}
        />
      ))}
    </div>
  )
}

function RunNode({
  node,
  depth,
  projectName,
  specName,
  highlightRunId,
  onNavigate,
}: {
  node: TreeNode
  depth: number
  projectName: string
  specName: string
  highlightRunId?: string
  onNavigate: (path: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const { run, children } = node
  const parsed = parseTaskKind(run.taskName)
  const status = runDisplayStatus(run)
  const Icon = KIND_ICON[parsed.kind]
  const isHighlighted = highlightRunId === run.id
  const url = runHref(run)
  const taskLabel = displayRunTaskName(run)

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-md border-l-2 bg-muted/[0.04] px-2 py-1.5 transition-colors hover:bg-accent/40',
          KIND_BORDER[parsed.kind],
          isHighlighted && 'bg-blue-500/[0.08] ring-1 ring-blue-500/40',
        )}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/60 hover:text-foreground"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', KIND_COLOR[parsed.kind])} />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onNavigate(url)}
        >
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
          <span className="truncate font-mono text-[11px] font-medium">{taskLabel}</span>
          <span className="font-mono text-[9px] text-muted-foreground/60">{run.agentName}</span>
          <span className="font-mono text-[9px] text-muted-foreground/40">{shortId(run.id)}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[9px] text-muted-foreground/60">
            <span>{runCost(run).label}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{timeAgo(run.lastHeartbeat ?? run.updatedAt)}</span>
            {status === 'done' && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
            {(status === 'failed' || status === 'stalled') && <XCircle className="h-3 w-3 text-red-400" />}
          </div>
        </button>
      </div>
      {!collapsed && children.length > 0 && (
        <div className="mt-1 space-y-1">
          {children.map((child) => (
            <RunNode
              key={child.run.id}
              node={child}
              depth={depth + 1}
              projectName={projectName}
              specName={specName}
              highlightRunId={highlightRunId}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Compact lineage breadcrumb for the RunDetail page header. Walks
 * `parentRunId` from the current run up to the lineage root and
 * shows: `IMPL P1 ▸ R1 review-P1 ▸ F1 fix-P1-r1 ▸ ◀ this run`.
 *
 * Useful when an operator lands on a fix-r2 run and needs to know
 * what came before it without scrolling the full tree.
 */
export function RunLineageBreadcrumb({
  projectName,
  specName,
  runId,
}: {
  projectName: string
  specName: string
  runId: string
}) {
  const { data: allRuns = [] } = useAllRuns({ limit: '500' })
  const navigate = useNavigate()

  const chain = useMemo(() => {
    const byId = new Map(allRuns.map((r) => [r.id, r]))
    const out: EnrichedRun[] = []
    let cursor = byId.get(runId)
    while (cursor != null) {
      out.unshift(cursor)
      if (cursor.parentRunId == null) break
      cursor = byId.get(cursor.parentRunId)
    }
    return out
  }, [allRuns, runId])

  if (chain.length <= 1) return null

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border border-border/30 bg-muted/[0.04] px-2 py-1.5 font-mono text-[10px]">
      <span className="text-muted-foreground/60">lineage:</span>
      {chain.map((run, i) => {
        const parsed = parseTaskKind(run.taskName)
        const Icon = KIND_ICON[parsed.kind]
        const isCurrent = run.id === runId
        const isLast = i === chain.length - 1
        const taskLabel = displayRunTaskName(run)
        return (
          <span key={run.id} className="flex items-center gap-1">
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 rounded border px-1 py-0 transition-colors',
                TASK_KIND_BADGE_CLASSES[parsed.kind],
                isCurrent && 'ring-1 ring-blue-400/60',
              )}
              onClick={() => {
                if (!isCurrent) {
                  navigate(`/${enc(projectName)}/${enc(specName)}/${enc(run.taskName)}/${shortId(run.id)}`)
                }
              }}
              title={`${parsed.roleLabel} - ${taskLabel}`}
            >
              <Icon className="h-2.5 w-2.5" />
              <span>{parsed.roleCode}</span>
              <span className="opacity-60">{shortId(run.id)}</span>
            </button>
            {!isLast && <span className="text-muted-foreground/40">▸</span>}
          </span>
        )
      })}
    </div>
  )
}

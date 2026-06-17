/**
 * Persistent tree navigator — left rail.
 *
 * Replaces the static "Factory / Agents / Approvals" link list with
 * a live tree of every project, every spec, and every lineage. The
 * operator can jump anywhere in two clicks without going through the
 * homepage. Each node shows a live status dot derived from the runs
 * that exist for it.
 *
 * Tree structure:
 *   Project
 *     └─ Spec
 *         └─ Lineage (impl task name)
 *
 * The lineage is the leaf — clicking it navigates to the spec page
 * with the lineage's impl task as the focus, since the SpecDetail
 * page already drills further from there.
 */

import { ChevronDown, ChevronRight, Cpu, FolderOpen, FolderTree, ListChecks, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import type { EnrichedRun, Project } from '@/api/client'
import { isAwaitingApproval } from '@/lib/derived-status'
import { computeLineageStage, type LineageStage } from '@/lib/lineage-stage'
import { runDisplayStatus } from '@/lib/run-presentation'
import { parseTaskKind } from '@/lib/task-kind'
import { cn } from '@/lib/utils'

function enc(segment: string): string {
  return encodeURIComponent(segment)
}

interface LineageNode {
  rootName: string
  runs: EnrichedRun[]
  stage: LineageStage
}

interface SpecNode {
  specName: string
  lineages: LineageNode[]
  liveCount: number
  awaitingCount: number
  failedCount: number
}

interface ProjectNode {
  project: Project
  specs: SpecNode[]
  liveCount: number
}

/** Build the project → spec → lineage tree from raw enriched runs. */
function buildTree(projects: Project[], runs: EnrichedRun[]): ProjectNode[] {
  // Group runs by projectName/specName/lineageRoot.
  const buckets = new Map<string, Map<string, Map<string, EnrichedRun[]>>>()
  for (const run of runs) {
    let projectMap = buckets.get(run.projectName)
    if (projectMap == null) {
      projectMap = new Map()
      buckets.set(run.projectName, projectMap)
    }
    let specMap = projectMap.get(run.specName)
    if (specMap == null) {
      specMap = new Map()
      projectMap.set(run.specName, specMap)
    }
    const { originalName } = parseTaskKind(run.taskName)
    const list = specMap.get(originalName) ?? []
    list.push(run)
    specMap.set(originalName, list)
  }

  return projects.map<ProjectNode>((project) => {
    const projectMap = buckets.get(project.name) ?? new Map()
    const specs: SpecNode[] = []
    let projectLive = 0
    for (const [specName, lineageMap] of projectMap) {
      const lineages: LineageNode[] = []
      let live = 0
      let awaiting = 0
      let failed = 0
      for (const [rootName, lineageRuns] of lineageMap) {
        const stage = computeLineageStage(lineageRuns)
        lineages.push({ rootName, runs: lineageRuns, stage })
        if (stage === 'failed') failed += 1
        if (lineageRuns.some((r: EnrichedRun) => runDisplayStatus(r) === 'running')) live += 1
        if (lineageRuns.some((r: EnrichedRun) => isAwaitingApproval(r))) awaiting += 1
      }
      lineages.sort((a, b) => a.rootName.localeCompare(b.rootName))
      specs.push({ specName, lineages, liveCount: live, awaitingCount: awaiting, failedCount: failed })
      projectLive += live
    }
    specs.sort((a, b) => a.specName.localeCompare(b.specName))
    return { project, specs, liveCount: projectLive }
  })
}

/** Pick the dot color from the rolled-up lineage stage. */
function dotClass(stage: LineageStage): string {
  if (stage === 'failed') return 'bg-red-400'
  if (stage === 'done') return 'bg-emerald-400/70'
  if (stage === 'ship') return 'bg-amber-400'
  if (stage === 'review' || stage === 'implement' || stage === 'understand') return 'bg-blue-400 live-dot'
  return 'bg-muted-foreground/40'
}

export function TreeNavigator({
  projects,
  runs,
}: {
  projects: Project[]
  runs: EnrichedRun[]
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const tree = useMemo(() => buildTree(projects, runs), [projects, runs])

  // Auto-expand the project/spec containing the URL the operator is
  // currently on, plus any project that has live work.
  const initialExpanded = useMemo(() => {
    const set = new Set<string>()
    const segments = location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (segments[0] != null) set.add(`project:${segments[0]}`)
    if (segments[0] != null && segments[1] != null) set.add(`spec:${segments[0]}/${segments[1]}`)
    for (const p of tree) {
      if (p.liveCount > 0) {
        set.add(`project:${p.project.name}`)
        for (const s of p.specs) {
          if (s.liveCount > 0 || s.awaitingCount > 0) {
            set.add(`spec:${p.project.name}/${s.specName}`)
          }
        }
      }
    }
    return set
  }, [tree, location.pathname])

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded)

  // Keep expanded set in sync with route changes (so navigation
  // expands the relevant nodes automatically). Without this, deep-
  // linking to a spec would land on the page but the tree would
  // still be collapsed.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of initialExpanded) next.add(id)
      return next
    })
  }, [initialExpanded])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Active path detection — used to highlight the current node.
  const activeSegments = location.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const activeProject = activeSegments[0]
  const activeSpec = activeSegments[1]
  const activeTask = activeSegments[2]

  return (
    <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Factory tree">
      <div className="mb-2 flex items-center gap-1.5 px-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
        <FolderTree className="h-3 w-3" />
        <span>Tree</span>
      </div>
      <ul className="space-y-px">
        {tree.map((projectNode) => {
          const projectId = `project:${projectNode.project.name}`
          const isProjectExpanded = expanded.has(projectId)
          const isProjectActive = activeProject === projectNode.project.name
          return (
            <li key={projectNode.project.name}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-sm px-1.5 py-1 transition-colors hover:bg-accent/40',
                  isProjectActive && activeSpec == null && 'bg-primary/10',
                )}
              >
                <button
                  type="button"
                  className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50 hover:text-foreground"
                  onClick={() => toggle(projectId)}
                  aria-label={isProjectExpanded ? 'Collapse' : 'Expand'}
                  aria-expanded={isProjectExpanded}
                >
                  {projectNode.specs.length === 0 ? null : isProjectExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-1.5 truncate text-left"
                  onClick={() => navigate(`/${enc(projectNode.project.name)}`)}
                >
                  <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                  <span className={cn('truncate text-[12px]', isProjectActive && activeSpec == null ? 'font-semibold text-foreground' : 'text-foreground/85')}>
                    {projectNode.project.name}
                  </span>
                  {projectNode.liveCount > 0 && (
                    <span className="font-mono text-[9px] text-blue-300">·{projectNode.liveCount}</span>
                  )}
                </button>
              </div>
              {isProjectExpanded && projectNode.specs.length > 0 && (
                <ul className="ml-3 space-y-px border-l border-border/30 pl-1">
                  {projectNode.specs.map((specNode) => {
                    const specId = `spec:${projectNode.project.name}/${specNode.specName}`
                    const isSpecExpanded = expanded.has(specId)
                    const isSpecActive = isProjectActive && activeSpec === specNode.specName
                    return (
                      <li key={specNode.specName}>
                        <div
                          className={cn(
                            'group flex items-center gap-1 rounded-sm px-1.5 py-1 transition-colors hover:bg-accent/40',
                            isSpecActive && activeTask == null && 'bg-primary/10',
                          )}
                        >
                          <button
                            type="button"
                            className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/50 hover:text-foreground"
                            onClick={() => toggle(specId)}
                            aria-label={isSpecExpanded ? 'Collapse' : 'Expand'}
                            aria-expanded={isSpecExpanded}
                          >
                            {specNode.lineages.length === 0 ? null : isSpecExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
                            onClick={() => navigate(`/${enc(projectNode.project.name)}/${enc(specNode.specName)}`)}
                          >
                            <ScrollText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            <span className={cn('truncate text-[11px]', isSpecActive && activeTask == null ? 'font-semibold text-foreground' : 'text-foreground/80')}>
                              {specNode.specName}
                            </span>
                            <SpecCounters spec={specNode} />
                          </button>
                        </div>
                        {isSpecExpanded && specNode.lineages.length > 0 && (
                          <ul className="ml-3 space-y-px border-l border-border/30 pl-1">
                            {specNode.lineages.map((lineage) => {
                              const isLineageActive =
                                isSpecActive && activeTask != null && parseTaskKind(activeTask).originalName === lineage.rootName
                              return (
                                <li key={lineage.rootName}>
                                  <button
                                    type="button"
                                    className={cn(
                                      'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left transition-colors hover:bg-accent/40',
                                      isLineageActive && 'bg-primary/10',
                                    )}
                                    onClick={() =>
                                      navigate(
                                        `/${enc(projectNode.project.name)}/${enc(specNode.specName)}/${enc(lineage.rootName)}`,
                                      )
                                    }
                                    title={`${lineage.rootName} — ${lineage.stage}`}
                                  >
                                    <span
                                      className={cn(
                                        'h-1.5 w-1.5 shrink-0 rounded-full',
                                        dotClass(lineage.stage),
                                      )}
                                      aria-hidden
                                    />
                                    <ListChecks className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                                    <span
                                      className={cn(
                                        'truncate font-mono text-[10px]',
                                        isLineageActive ? 'font-semibold text-foreground' : 'text-muted-foreground/80',
                                      )}
                                    >
                                      {lineage.rootName}
                                    </span>
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function SpecCounters({ spec }: { spec: SpecNode }) {
  const total = spec.liveCount + spec.awaitingCount + spec.failedCount
  if (total === 0) return null
  return (
    <span className="ml-auto flex items-center gap-1 font-mono text-[9px]">
      {spec.liveCount > 0 && <span className="text-blue-300">{spec.liveCount}↻</span>}
      {spec.awaitingCount > 0 && <span className="text-amber-300">{spec.awaitingCount}!</span>}
      {spec.failedCount > 0 && <span className="text-red-300">{spec.failedCount}✕</span>}
    </span>
  )
}

/** Compact "Other links" row at the bottom of the sidebar — Agents / Approvals. */
export function TreeFooterLinks() {
  const navigate = useNavigate()
  const location = useLocation()
  const isAgentsActive = location.pathname.startsWith('/agents')
  const isApprovalsActive = location.pathname.startsWith('/approvals')
  return (
    <div className="mt-2 flex items-center gap-2 border-t border-border/30 px-3 py-2 text-[10px]">
      <button
        type="button"
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 transition-colors',
          isAgentsActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground',
        )}
        onClick={() => navigate('/agents')}
      >
        <Cpu className="h-3 w-3" /> Agents
      </button>
      <button
        type="button"
        className={cn(
          'flex items-center gap-1 rounded px-2 py-1 transition-colors',
          isApprovalsActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground',
        )}
        onClick={() => navigate('/approvals')}
      >
        <ListChecks className="h-3 w-3" /> Approvals
      </button>
    </div>
  )
}

import { useQueries } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { api, type EnrichedRun, type Task } from '@/api/client'
import { useAllRuns, useProjects } from '@/api/hooks'
import {
  Card,
  MetricPill,
  Mono,
  Page,
  PageHeader,
  tokens,
} from '@/components/signal'
import { isAwaitingApproval } from '@/lib/derived-status'
import { runCost, runDisplayStatus } from '@/lib/run-presentation'
import { WORKFLOW_STAGES } from '@/lib/stage-display'
import { ImportSpecProjectPicker } from '@/specs/ImportSpecProjectPicker'
import { isLiveRun, specStatus, SpecProjectSection, type SpecRow } from '@/specs/SpecProjectSection'

type SpecFilter = 'current' | 'attention' | 'all'

function enc(s: string): string {
  return encodeURIComponent(s)
}

export function SpecList() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<SpecFilter>('current')
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: runsData } = useAllRuns({ limit: '200' })
  const runs = useMemo(() => (runsData as EnrichedRun[] | undefined) ?? [], [runsData])

  const specQueries = useQueries({
    queries: (projects ?? []).map((p) => ({
      queryKey: ['specs', { projectId: p.id }],
      queryFn: () => api.listSpecs(p.id),
    })),
  })
  const taskQueries = useQueries({
    queries: (projects ?? []).map((p) => ({
      queryKey: ['projects', p.id, 'tasks'],
      queryFn: () => api.getProjectTasks(p.id),
    })),
  })
  const specsLoading = specQueries.some((q) => q.isLoading)

  const rows = useMemo<SpecRow[]>(() => {
    if (!projects) return []
    const acc: SpecRow[] = []
    specQueries.forEach((q, i) => {
      const project = projects[i]
      if (!project || !q.data) return
      const projectTasks: Task[] = taskQueries[i]?.data ?? []
      const tasksBySpec = new Map<string, Task[]>()
      for (const task of projectTasks) {
        const list = tasksBySpec.get(task.specId) ?? []
        list.push(task)
        tasksBySpec.set(task.specId, list)
      }
      for (const spec of q.data) {
        const specRuns = runs.filter(
          (r) => r.projectName === project.name && r.specName === spec.name,
        )
        const derivedStageIdx = specRuns.reduce((mx, r) => {
          const idx = WORKFLOW_STAGES.indexOf(r.stage as (typeof WORKFLOW_STAGES)[number])
          return idx > mx ? idx : mx
        }, 0)
        const stageIdx = spec.status === 'done'
          ? WORKFLOW_STAGES.indexOf('done')
          : derivedStageIdx
        const specTasks = tasksBySpec.get(spec.id) ?? []
        const hasCurrentFailure = spec.status !== 'done' && specRuns.some((r) => {
          const status = runDisplayStatus(r)
          return status === 'failed' || status === 'stalled'
        })
        acc.push({
          spec,
          projectName: project.name,
          runs: specRuns,
          taskCount: specTasks.length,
          costSum: specRuns.reduce((s, r) => s + runCost(r).usd, 0),
          stageIdx,
          failing: hasCurrentFailure,
          awaiting: specRuns.some((r) => isActionableApproval(r, specRuns)),
          liveCount: specRuns.filter(isLiveRun).length,
        })
      }
    })
    // Sort: awaiting first, then live, then by newest createdAt.
    acc.sort((a, b) => {
      const aw = (b.awaiting ? 1 : 0) - (a.awaiting ? 1 : 0)
      if (aw !== 0) return aw
      const lv = b.liveCount - a.liveCount
      if (lv !== 0) return lv
      return new Date(b.spec.createdAt).getTime() - new Date(a.spec.createdAt).getTime()
    })
    return acc
  }, [projects, specQueries, taskQueries, runs])

  const inFlight = useMemo(
    () => rows.filter((row) => (row.awaiting || row.liveCount > 0) && !row.failing).length,
    [rows],
  )
  const attentionCount = useMemo(
    () => rows.filter((row) => isAttentionRow(row)).length,
    [rows],
  )
  const visibleRows = useMemo(
    () => rows.filter((row) => matchesFilter(row, filter)),
    [rows, filter],
  )
  const groupedRows = useMemo(() => {
    const groups = new Map<string, SpecRow[]>()
    for (const row of visibleRows) {
      const group = groups.get(row.projectName) ?? []
      group.push(row)
      groups.set(row.projectName, group)
    }
    return [...groups.entries()]
  }, [visibleRows])
  const filterLabel = filter === 'attention' ? 'attention' : filter === 'all' ? 'total' : 'current'

  if (projectsLoading || specsLoading) {
    return (
      <Page maxWidth={1280}>
        <div className="shimmer" style={{ height: 120, borderRadius: 10, marginBottom: 24 }} />
        <div className="shimmer" style={{ height: 320, borderRadius: 10 }} />
      </Page>
    )
  }

  return (
    <Page maxWidth={1280}>
      <PageHeader
        eyebrow="Specs"
        title={(
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 44, lineHeight: 0.95 }}>{visibleRows.length}</span>
            <span>{filterLabel} spec{visibleRows.length === 1 ? '' : 's'}</span>
          </span>
        )}
        metrics={[
          <MetricPill key="total" label="total" value={rows.length} />,
          <MetricPill key="active" label="active" value={inFlight} tone="info" hideZero={false} />,
          <MetricPill key="attention" label="attention" value={attentionCount} tone="err" />,
        ]}
        actions={(
          <>
          <div
            role="tablist"
            aria-label="Spec filter"
            style={{
              display: 'flex',
              gap: 6,
              padding: 4,
              border: `1px solid ${tokens.hair}`,
              borderRadius: 8,
              background: tokens.raised,
            }}
          >
            <FilterButton active={filter === 'current'} onClick={() => setFilter('current')}>
              Current
            </FilterButton>
            <FilterButton active={filter === 'attention'} onClick={() => setFilter('attention')}>
              Needs attention {attentionCount > 0 ? `(${attentionCount})` : ''}
            </FilterButton>
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterButton>
          </div>
          {projects && projects.length > 0 && (
            <ImportSpecProjectPicker projects={projects} />
          )}
          </>
        )}
      />

      {rows.length === 0 ? (
        <Card>
          <div style={{ padding: '24px 8px', textAlign: 'center' }}>
            <Mono size={13} color={tokens.faint}>
              No specs in the factory yet.
            </Mono>
          </div>
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card>
          <div style={{ padding: '24px 8px', textAlign: 'center' }}>
            <Mono size={13} color={tokens.faint}>
              No specs match this filter.
            </Mono>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: 26 }}>
          {groupedRows.map(([projectName, projectRows]) => (
            <SpecProjectSection
              key={projectName}
              projectName={projectName}
              rows={projectRows}
              onOpen={(row) => navigate(`/${enc(row.projectName)}/${enc(row.spec.name)}`)}
            />
          ))}
        </div>
      )}
    </Page>
  )
}

function matchesFilter(row: SpecRow, filter: SpecFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'attention') return isAttentionRow(row)
  return !isAttentionRow(row)
}

function isAttentionRow(row: SpecRow): boolean {
  const status = specStatus(row).key
  return status === 'failed' || status === 'blocked' || status === 'recovering'
}

function isActionableApproval(run: EnrichedRun, runs: EnrichedRun[]): boolean {
  if (!isAwaitingApproval(run)) return false
  const open = [run.id]
  while (open.length > 0) {
    const parentId = open.pop()
    for (const candidate of runs) {
      if (candidate.parentRunId !== parentId) continue
      if (isLiveRun(candidate)) return false
      open.push(candidate.id)
    }
  }
  return true
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        minHeight: 32,
        padding: '0 12px',
        borderRadius: 6,
        border: `1px solid ${active ? tokens.accent : 'transparent'}`,
        background: active ? 'color-mix(in srgb, var(--signal-accent) 16%, transparent)' : 'transparent',
        color: active ? tokens.strong : tokens.mid,
        fontFamily: tokens.sans,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

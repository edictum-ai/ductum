import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import type { Agent, ProjectRun, Repository, Spec, Task } from '@/api/client'
import { SpecSection } from '@/components/project/ProjectSpecSection'
import { Btn, SectionHeading } from '@/components/signal'
import { Input } from '@/components/ui/input'
import { deriveSpecStatus } from '@/lib/derived-status'
import { displaySpecName, displayTaskName } from '@/lib/project-display'
import { buildSpecBrief } from '@/lib/spec-brief'

const PAGE_SIZE = 10
type SpecSort = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc'

const SORT_OPTIONS: ReadonlyArray<{ value: SpecSort; label: string }> = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'name_asc', label: 'A-Z' },
  { value: 'name_desc', label: 'Z-A' },
]

export function ProjectSpecsSection({
  projectName,
  specs,
  tasks,
  runs,
  agents,
  repositories,
}: {
  projectName: string
  specs: Spec[]
  tasks: Task[]
  runs: ProjectRun[]
  agents: Agent[]
  repositories: Repository[]
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState<SpecSort>('date_desc')
  const rows = useMemo(() => specs.map((spec) => {
    const specTasks = tasks.filter((task) => task.specId === spec.id)
    const specRuns = runs.filter((run) => run.specName === spec.name) as unknown as ProjectRun[]
    const brief = buildSpecBrief({ spec, tasks: specTasks, projectName, repositories })
    const status = deriveSpecStatus(spec, specTasks, specRuns)
    const searchText = [
      displaySpecName(spec),
      status,
      brief.summary,
      brief.audience,
      brief.sourceLabel,
      ...brief.highlights,
      ...specTasks.map(displayTaskName),
    ].filter(Boolean).join(' ').toLowerCase()
    return { spec, tasks: specTasks, runs: specRuns, status, searchText }
  }), [projectName, repositories, runs, specs, tasks])
  const statusOptions = useMemo(
    () => [...new Set(rows.map((row) => row.status))].sort(),
    [rows],
  )
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false
      return normalizedQuery === '' || row.searchText.includes(normalizedQuery)
    })
  }, [query, rows, statusFilter])
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((left, right) => compareSpecRows(left, right, sortBy))
  }, [filteredRows, sortBy])
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const [page, setPage] = useState(1)
  const currentPage = Math.min(page, totalPages)
  const visibleRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const rangeStart = sortedRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, sortedRows.length)
  if (specs.length === 0) return null

  return (
    <section>
      <SectionHeading
        title="Specs"
        meta={filteredRows.length === specs.length ? `${specs.length} total` : `${filteredRows.length}/${specs.length} visible`}
        level={2}
      />
      <div className="mb-3 grid gap-2 rounded-lg border border-border/30 bg-card/30 p-3 md:grid-cols-[minmax(0,1fr)_180px_160px_auto]">
        <label className="relative block">
          <span className="sr-only">Search specs</span>
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground/50" />
          <Input
            aria-label="Search specs"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="Search specs, objectives, tasks..."
            className="pl-8"
          />
        </label>
        <select
          aria-label="Filter specs by status"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value)
            setPage(1)
          }}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
        <select
          aria-label="Sort specs"
          value={sortBy}
          onChange={(event) => {
            setSortBy(event.target.value as SpecSort)
            setPage(1)
          }}
          className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-2 md:justify-end">
          <span className="font-mono text-[11px] text-muted-foreground/65">
            {rangeStart}-{rangeEnd} of {sortedRows.length}
          </span>
          <Btn small disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
            Previous
          </Btn>
          <Btn small disabled={currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
            Next
          </Btn>
        </div>
      </div>
      <div className="space-y-3">
        {visibleRows.map(({ spec, tasks: specTasks, runs: specRuns }) => (
          <SpecSection
            key={spec.id}
            spec={spec}
            tasks={specTasks}
            specRuns={specRuns}
            agents={agents}
            navigate={navigate}
            projectName={projectName}
            repositories={repositories}
          />
        ))}
        {sortedRows.length === 0 && (
          <div className="rounded-lg border border-border/30 bg-card/30 p-6 text-center text-sm text-muted-foreground">
            No specs match the current search and status filters.
          </div>
        )}
      </div>
    </section>
  )
}

type SpecRow = {
  spec: Spec
  tasks: Task[]
  runs: ProjectRun[]
  status: string
  searchText: string
}

function compareSpecRows(left: SpecRow, right: SpecRow, sortBy: SpecSort): number {
  if (sortBy === 'date_desc' || sortBy === 'date_asc') {
    const direction = sortBy === 'date_desc' ? -1 : 1
    const byDate = (specRecency(left.spec) - specRecency(right.spec)) * direction
    if (byDate !== 0) return byDate
    return compareSpecNames(left, right)
  }
  const byName = compareSpecNames(left, right)
  return sortBy === 'name_asc' ? byName : -byName
}

function compareSpecNames(left: SpecRow, right: SpecRow): number {
  return displaySpecName(left.spec).localeCompare(displaySpecName(right.spec), undefined, {
    numeric: true,
    sensitivity: 'base',
  }) || left.spec.id.localeCompare(right.spec.id)
}

/**
 * Deterministic recency score for a spec. Prefers `updatedAt`, falls back to
 * `createdAt`, then to 0 so ties fall through to the name/id tiebreaker in
 * `compareSpecRows`. This keeps "Newest first" reflecting the most recent
 * spec activity rather than stale import order.
 */
function specRecency(spec: Spec): number {
  const updated = Date.parse(spec.updatedAt)
  if (Number.isFinite(updated) && updated > 0) return updated
  const created = Date.parse(spec.createdAt)
  return Number.isFinite(created) ? created : 0
}

import { FolderKanban } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import type { EnrichedRun, Project } from '@/api/client'
import { useAllRuns, useOperatorBrief, useProjectTasks, useProjects, useSpecs } from '@/api/hooks'
import { CreateProjectDialog } from '@/components/CreateProjectDialog'
import { Card, MetricPill, Mono, Page, PageHeader, SectionHeading, tokens } from '@/components/signal'
import { CLEAN_DONE_TITLE } from '@/lib/clean-done'
import { costCoverageRollup, summarizeCostCoverage } from '@/lib/cost-coverage'
import { hasExecutionIntegrityIssue } from '@/lib/execution-integrity'
import { runDisplayStatus } from '@/lib/run-presentation'
import { formatCost } from '@/lib/utils'

function enc(value: string): string {
  return encodeURIComponent(value)
}

interface ProjectSummary {
  project: Project
  attempts: EnrichedRun[]
  attention: number
  approvals: number
  running: number
  cleanDone: number
  historicalAttention: number
  priority: number
  updatedAtMs: number
}

export function Projects() {
  const navigate = useNavigate()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: brief } = useOperatorBrief()
  const { data: attemptsData } = useAllRuns({ limit: '500' })
  const attempts = (attemptsData as EnrichedRun[] | undefined) ?? []

  if (projectsLoading) {
    return (
      <Page maxWidth={1180}>
        <div className="shimmer" style={{ height: 160, borderRadius: 10, marginBottom: 24 }} />
        <div className="shimmer" style={{ height: 280, borderRadius: 10 }} />
      </Page>
    )
  }

  const projectList = projects ?? []
  const liveAttempts = attempts.filter((attempt) => runDisplayStatus(attempt) === 'running').length
  const projectSummaries = buildProjectSummaries(projectList, attempts, brief?.queue.needsOperatorAttempts ?? [])

  return (
    <Page maxWidth={1180}>
      <PageHeader
        eyebrow="Projects"
        title="Projects"
        icon={<FolderKanban className="h-4 w-4" />}
        subtitle="Projects own repositories, components, specs, tasks, and attempts."
        actions={<CreateProjectDialog onCreated={(projectName) => navigate(`/${enc(projectName)}`)} />}
        metrics={(
          <>
            <MetricPill label="projects" value={projectList.length} />
            <MetricPill label="latest attempts" value={attempts.length} title="Derived from the latest 500 fetched attempts." />
            <MetricPill label="running" value={liveAttempts} tone="info" />
          </>
        )}
      />

      <section>
        <SectionHeading title="Project list" meta={`${projectList.length} configured`} />
        {projectList.length === 0 ? (
          <Card>
            <Mono size={12} color={tokens.faint}>No projects configured yet.</Mono>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
            {projectSummaries.map((summary) => (
              <ProjectCard key={summary.project.id} summary={summary} />
            ))}
          </div>
        )}
      </section>
    </Page>
  )
}

function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { project, attempts } = summary
  const { data: specs } = useSpecs(project.id)
  const { data: tasks } = useProjectTasks(project.id)
  const repositoryCount = project.repos.length
  const specCount = specs?.length ?? 0
  const taskCount = tasks?.length ?? 0
  const signal = projectSignal(summary)
  const cost = projectCostLabel(summary)

  return (
    <Link
      to={`/${enc(project.name)}`}
      style={{
        display: 'block',
        color: 'inherit',
        textDecoration: 'none',
      }}
    >
      <Card style={{ minHeight: 154 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span style={{ width: 8, height: 8, borderRadius: 8, background: signal.color, flexShrink: 0, marginTop: 8 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: tokens.strong }}>{project.name}</div>
              <Mono size={11} color={signal.color} title={signal.title}>{signal.label}</Mono>
            </div>
          </div>
          <div>
            <Mono size={11} color={tokens.dim}>{repositoryCount} repositor{repositoryCount === 1 ? 'y' : 'ies'}</Mono>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <MetricPill label="specs" value={specCount} />
            <MetricPill label="tasks" value={taskCount} />
            <MetricPill label="attempts" value={attempts.length} />
          </div>
          <Mono size={11} color={tokens.dim} title={CLEAN_DONE_TITLE}>
            {cost}
          </Mono>
        </div>
      </Card>
    </Link>
  )
}

function buildProjectSummaries(projects: Project[], attempts: EnrichedRun[], attentionAttempts: EnrichedRun[]): ProjectSummary[] {
  const attentionByProject = countBy(attentionAttempts, (attempt) => attempt.projectName)
  return projects.map((project) => {
    const projectAttempts = attempts.filter((attempt) => attempt.projectName === project.name)
    const attention = attentionByProject.get(project.name) ?? 0
    let historicalAttention = 0
    let approvals = 0
    let running = 0
    let cleanDone = 0
    for (const attempt of projectAttempts) {
      const status = runDisplayStatus(attempt)
      const hasIntegrityIssue = hasExecutionIntegrityIssue(attempt)
      if (status === 'failed' || status === 'stalled' || hasIntegrityIssue) {
        historicalAttention += 1
      } else if (status === 'awaiting_approval') {
        approvals += 1
      } else if (status === 'running' || status === 'awaiting_review') {
        running += 1
      } else if (status === 'done') {
        cleanDone += 1
      }
    }
    const updatedAtMs = projectAttempts.reduce(
      (latest, attempt) => Math.max(latest, new Date(attempt.updatedAt).getTime()),
      new Date(project.updatedAt).getTime(),
    )
    const priority = attention * 1000 + approvals * 500 + running * 100
    return { project, attempts: projectAttempts, attention, approvals, running, cleanDone, historicalAttention, priority, updatedAtMs }
  }).sort((a, b) => b.priority - a.priority || b.updatedAtMs - a.updatedAtMs || a.project.name.localeCompare(b.project.name))
}

function projectSignal(summary: ProjectSummary): { label: string; color: string; title?: string } {
  if (summary.attention > 0) return { label: `${summary.attention} failed/stalled`, color: tokens.err, title: 'Current operator action required' }
  if (summary.approvals > 0) return { label: `${summary.approvals} awaiting approval`, color: tokens.warn }
  if (summary.running > 0) return { label: `${summary.running} active`, color: tokens.info }
  if (summary.cleanDone > 0) return { label: `${summary.cleanDone} clean done`, color: tokens.ok, title: CLEAN_DONE_TITLE }
  if (summary.historicalAttention > 0) return { label: `${summary.historicalAttention} past failed/stalled`, color: tokens.warn }
  return { label: 'no attempts yet', color: tokens.dim }
}

function countBy<T>(items: T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function projectCostLabel(summary: ProjectSummary): string {
  const coverage = summarizeCostCoverage(summary.attempts)
  // Keep failed/flagged spend in the numerator: this is effective cost per clean outcome, not filtered clean-run spend.
  const perCleanDone = summary.cleanDone > 0 && coverage.trackedUsd > 0
    ? `${formatCost(coverage.trackedUsd / summary.cleanDone)}/clean done`
    : summary.cleanDone > 0 ? 'cost unknown/clean done' : 'no clean done yet'
  return `${costCoverageRollup(coverage)} · ${perCleanDone}`
}

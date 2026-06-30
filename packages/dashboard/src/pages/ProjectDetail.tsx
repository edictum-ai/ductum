import { FolderOpen } from 'lucide-react'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { EnrichedRun, Repository } from '@/api/client'
import {
  useAgents,
  useAllRuns,
  useOperatorBrief,
  useProjectAgents,
  useProjectRepositories,
  useProjectTasks,
  useResolveProject,
  useSpecs,
} from '@/api/hooks'
import { CreateSpecDialog } from '@/components/CreateSpecDialog'
import { CreateBakeoffDialog } from '@/components/CreateBakeoffDialog'
import { ImportSpecDialog } from '@/components/ImportSpecDialog'
import { buildSpecGroups, SpecGroupCard } from '@/components/homepage/SpecGroups'
import { AddRepositoryDialog } from '@/components/project/AddRepositoryDialog'
import { ProjectAgentsPanel } from '@/components/project/ProjectAgentsPanel'
import { ProjectContextSection } from '@/components/project/ProjectContextSection'
import { ProjectSettingsPanel } from '@/components/project/ProjectSettingsPanel'
import { ProjectSpecsSection } from '@/components/project/ProjectSpecsSection'
import { ReadyTaskQueue } from '@/components/project/ReadyTaskQueue'
import { Card, MetricPill, Mono, Page, PageHeader, SectionHeading, tokens } from '@/components/signal'
import { costCoverageIssues, costCoverageValue, summarizeCostCoverage } from '@/lib/cost-coverage'
import { runDisplayStatus } from '@/lib/run-presentation'
import { projectAudience, projectPurpose } from '@/lib/spec-brief'

export function ProjectDetail() {
  const { project: projectSlug } = useParams<{ project: string }>()
  const navigate = useNavigate()
  const { data: resolved, isLoading } = useResolveProject(projectSlug ?? '')
  const project = resolved?.project
  const { data: projectAgents } = useProjectAgents(project?.id ?? '')
  const { data: repositories } = useProjectRepositories(project?.id ?? '')
  const { data: agents } = useAgents()
  const { data: specs } = useSpecs(project?.id ?? '')
  const { data: allTasks } = useProjectTasks(project?.id ?? '')
  const { data: allRuns = [] } = useAllRuns({ limit: '500' })
  const { data: operatorBrief } = useOperatorBrief()

  const projectRuns = useMemo(
    () => (allRuns as EnrichedRun[]).filter((r) => r.projectName === project?.name),
    [allRuns, project?.name],
  )
  const specGroups = useMemo(() => buildSpecGroups(projectRuns), [projectRuns])
  const activeGroups = useMemo(
    () => specGroups.filter((g) => g.liveLineageCount > 0 || g.awaitingCount > 0),
    [specGroups],
  )
  const historyGroups = useMemo(
    () => specGroups.filter((g) => g.liveLineageCount === 0 && g.awaitingCount === 0),
    [specGroups],
  )

  if (isLoading) {
    return (
      <Page maxWidth={1480}>
        <div className="shimmer h-40 rounded-lg border border-border/20 bg-card/30" />
      </Page>
    )
  }
  if (!project) return <Page><p className="text-muted-foreground">Project not found</p></Page>

  const totalRuns = projectRuns.length
  const liveRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'running').length
  const awaitingRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'awaiting_approval').length
  const failedLineages = specGroups.reduce((sum, group) => sum + group.failedCount, 0)
  const doneRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'done').length
  const canonicalReadyIds = operatorBrief?.queue.readyTaskIds == null
    ? null
    : new Set(operatorBrief.queue.readyTaskIds)
  const queuedTasks = (allTasks ?? []).filter((t) =>
    t.status === 'ready' && (canonicalReadyIds == null || canonicalReadyIds.has(t.id)),
  )
  const costCoverage = summarizeCostCoverage(projectRuns)
  const costGapCount = costCoverage.missingUsage + costCoverage.missingPrice
  const costGapDetail = costCoverageIssues(costCoverage)
  const totalSpecs = specs?.length ?? 0
  const totalTasks = allTasks?.length ?? 0
  const createActions = (
    <div className="flex gap-2">
      <CreateBakeoffDialog
        projectId={project.id}
        agents={agents ?? []}
        projectAgents={projectAgents ?? []}
        repositories={repositories ?? []}
        onCreated={(specName) => navigate(`/${encodeURIComponent(project.name)}/${encodeURIComponent(specName)}`)}
      />
      <CreateSpecDialog projectId={project.id} />
      <ImportSpecDialog projectId={project.id} />
    </div>
  )

  return (
    <Page maxWidth={1480}>
      <PageHeader
        eyebrow="Project"
	        title={project.name}
	        icon={<FolderOpen className="h-4 w-4" />}
	        subtitle={(
	          <div className="grid gap-1 text-sm leading-6 text-muted-foreground">
	            <span><span className="text-foreground/80">For:</span> {projectAudience(project, repositories ?? [])}</span>
	            <span><span className="text-foreground/80">Purpose:</span> {projectPurpose(project, repositories ?? [])}</span>
	          </div>
	        )}
	        actions={createActions}
	        metrics={(
	          <>
	            <MetricPill label="running" value={liveRuns} tone="info" title="Derived from the latest 500 fetched attempts." />
	            <MetricPill label="awaiting" value={awaitingRuns} tone="accent" title="Derived from the latest 500 fetched attempts." />
	            <MetricPill label="failed history" value={failedLineages} tone="warn" title="Derived from the latest 500 fetched attempts." />
	            <MetricPill label="done" value={doneRuns} tone="ok" title="Derived from the latest 500 fetched attempts." />
	            <MetricPill label="tracked spend" value={costCoverageValue(costCoverage)} title="Derived from the latest 500 fetched attempts." />
	            <MetricPill label="cost gaps" value={costGapCount} tone={costGapCount > 0 ? 'warn' : 'default'} title={costGapDetail || undefined} />
	          </>
	        )}
	      />

	      <div className="space-y-6">
	        <ProjectContextSection project={project} repositories={repositories ?? []} />

	        <ProjectScopeSection
	          repositories={repositories ?? []}
	          fallbackRepos={project.repos}
          specCount={totalSpecs}
          taskCount={totalTasks}
          attemptCount={totalRuns}
	          action={<AddRepositoryDialog projectId={project.id} />}
	        />

        <ProjectSettingsPanel
          project={project}
          onRenamed={(projectName) => navigate(`/${encodeURIComponent(projectName)}`)}
        />

        <ProjectSpecsSection
          projectName={project.name}
          specs={specs ?? []}
          tasks={allTasks ?? []}
          runs={projectRuns}
          agents={agents ?? []}
          repositories={repositories ?? []}
        />

        {activeGroups.length > 0 && (
          <section>
            <SectionHeading
              title="Active work"
              meta={`${activeGroups.length} spec${activeGroups.length === 1 ? '' : 's'}`}
            />
            <div className="space-y-3">
              {activeGroups.map((g) => (
                <SpecGroupCard key={`${g.projectName}/${g.specName}`} group={g} />
              ))}
            </div>
          </section>
        )}

        {historyGroups.length > 0 && (
          <section>
            <SectionHeading
              title="History"
              meta={`${historyGroups.length} spec${historyGroups.length === 1 ? '' : 's'}`}
            />
            <div className="space-y-3">
              {historyGroups.map((g) => (
                <SpecGroupCard key={`${g.projectName}/${g.specName}`} group={g} />
              ))}
            </div>
          </section>
        )}

        {specGroups.length === 0 && totalSpecs === 0 && (
          <div className="rounded-lg border border-border/40 bg-card/30 p-6 text-center">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">No specs yet</p>
            <p className="mt-2 text-sm text-muted-foreground">Create or import a spec to start dispatching work to this project.</p>
            <div className="mt-3 flex justify-center gap-2">
              {createActions}
            </div>
          </div>
        )}

        {queuedTasks.length > 0 && (
          <ReadyTaskQueue
            projectName={project.name}
            tasks={queuedTasks}
            specs={specs ?? []}
            agents={agents ?? []}
            projectAgents={projectAgents ?? []}
          />
        )}

        <ProjectAgentsPanel
          projectId={project.id}
          agents={agents ?? []}
          projectAgents={projectAgents ?? []}
          projectRuns={projectRuns}
          navigate={navigate}
        />
      </div>
    </Page>
  )
}

function ProjectScopeSection({
  repositories,
  fallbackRepos,
  specCount,
  taskCount,
  attemptCount,
  action,
}: {
  repositories: Repository[]
  fallbackRepos: string[]
  specCount: number
  taskCount: number
  attemptCount: number
  action?: ReactNode
}) {
  const repositoryNames = repositories.length > 0
    ? repositories.map((repo) => repo.name)
    : fallbackRepos.map((repo) => repo.split('/').pop() ?? repo)
  const componentNames = repositories.flatMap((repo) =>
    (repo.components ?? []).map((component) => `${repo.name}/${component.name}`),
  )

  return (
    <section>
      <SectionHeading title="Under this project" meta="scope" action={action} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <ScopeCard title="Repositories" value={repositoryNames.length} lines={repositoryNames} empty="No repositories configured" />
        <ScopeCard title="Components" value={componentNames.length} lines={componentNames} empty="Optional repository scopes" />
        <ScopeCard title="Specs" value={specCount} />
        <ScopeCard title="Tasks" value={taskCount} />
        <ScopeCard title="Attempts" value={attemptCount} />
      </div>
    </section>
  )
}

function ScopeCard({
  title,
  value,
  lines,
  empty,
}: {
  title: string
  value: number
  lines?: string[]
  empty?: string
}) {
  return (
    <Card pad={14}>
      <div style={{ display: 'grid', gap: 8 }}>
        <Mono size={11} color={tokens.dim}>{title}</Mono>
        <div style={{ fontSize: 28, lineHeight: 1, color: tokens.strong, fontWeight: 500 }}>{value}</div>
        {lines != null && (
          <div style={{ display: 'grid', gap: 3 }}>
            {lines.length === 0 ? (
              <Mono size={11} color={tokens.faint}>{empty}</Mono>
            ) : lines.slice(0, 3).map((line) => (
              <Mono key={line} size={11} color={tokens.mid} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {line}
              </Mono>
            ))}
            {lines.length > 3 && <Mono size={11} color={tokens.faint}>+{lines.length - 3} more</Mono>}
          </div>
        )}
      </div>
    </Card>
  )
}

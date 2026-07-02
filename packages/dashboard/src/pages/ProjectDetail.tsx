import { FolderOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import type { ProjectRun } from '@/api/client'
import {
  useAgents,
  useOperatorBrief,
  useProjectAgents,
  useProjectRepositories,
  useProjectRuns,
  useProjectTasks,
  useResolveProject,
  useSpecs,
} from '@/api/hooks'
import { CreateSpecDialog } from '@/components/CreateSpecDialog'
import { CreateBakeoffDialog } from '@/components/CreateBakeoffDialog'
import { ImportSpecDialog } from '@/components/ImportSpecDialog'
import { buildSpecGroups } from '@/components/homepage/SpecGroups'
import { AddRepositoryDialog } from '@/components/project/AddRepositoryDialog'
import { ProjectAgentsPanel } from '@/components/project/ProjectAgentsPanel'
import { ProjectContextSection } from '@/components/project/ProjectContextSection'
import { toEnrichedRuns } from '@/components/project/ProjectControlPanel'
import { ProjectSettingsPanel } from '@/components/project/ProjectSettingsPanel'
import { ProjectScopeSection } from '@/components/project/ProjectScopeSection'
import { ProjectSpecsSection } from '@/components/project/ProjectSpecsSection'
import { ReadyTaskQueue } from '@/components/project/ReadyTaskQueue'
import { Btn, LinkButton, MetricPill, Mono, Page, PageHeader, tokens } from '@/components/signal'
import { costCoverageIssues, costCoverageValue, summarizeCostCoverage } from '@/lib/cost-coverage'
import { runDisplayStatus } from '@/lib/run-presentation'
import { projectAudience, projectPurpose } from '@/lib/spec-brief'

export function ProjectDetail() {
  const { project: projectSlug } = useParams<{ project: string }>()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { data: resolved, isLoading } = useResolveProject(projectSlug ?? '')
  const project = resolved?.project
  const { data: projectAgents, isLoading: projectAgentsLoading } = useProjectAgents(project?.id ?? '')
  const { data: repositories, isLoading: repositoriesLoading } = useProjectRepositories(project?.id ?? '')
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const { data: specs, isLoading: specsLoading } = useSpecs(project?.id ?? '')
  const { data: allTasks, isLoading: tasksLoading } = useProjectTasks(project?.id ?? '')
  const { data: allRuns, isLoading: runsLoading } = useProjectRuns(project?.id ?? '')
  const { data: operatorBrief } = useOperatorBrief()

  const projectRuns = useMemo(
    () => ((allRuns ?? []) as ProjectRun[]).map((run) => ({ ...run, projectName: project?.name ?? '' })),
    [allRuns, project?.name],
  )
  const specGroups = useMemo(() => buildSpecGroups(toEnrichedRuns(projectRuns)), [projectRuns])
  if (isLoading) {
    return (
      <Page maxWidth={1480}>
        <div className="shimmer h-40 rounded-lg border border-border/20 bg-card/30" />
      </Page>
    )
  }
  if (!project) return <Page><p className="text-muted-foreground">Project not found</p></Page>

  const projectDataLoading = projectAgentsLoading || repositoriesLoading || agentsLoading || specsLoading || tasksLoading || runsLoading
  if (projectDataLoading) return <ProjectDetailLoading projectName={project.name} />

  const repositoriesList = repositories ?? []
  const agentsList = agents ?? []
  const specsList = specs ?? []
  const tasksList = allTasks ?? []
  const totalRuns = projectRuns.length
  const liveRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'running').length
  const awaitingRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'awaiting_approval').length
  const failedLineages = specGroups.reduce((sum, group) => sum + group.failedCount, 0)
  const doneRuns = projectRuns.filter((r) => runDisplayStatus(r) === 'done').length
  const canonicalReadyIds = operatorBrief?.queue.readyTaskIds == null ? null : new Set(operatorBrief.queue.readyTaskIds)
  const queuedTasks = tasksList.filter((t) =>
    t.status === 'ready' && (canonicalReadyIds == null || canonicalReadyIds.has(t.id)),
  )
  const costCoverage = summarizeCostCoverage(projectRuns)
  const costGapCount = costCoverage.missingUsage + costCoverage.missingPrice
  const costGapDetail = costCoverageIssues(costCoverage)
  const totalSpecs = specsList.length
  const totalTasks = tasksList.length
  const createActions = (
    <div className="flex gap-2">
      <Btn onClick={() => setSettingsOpen((open) => !open)}>
        {settingsOpen ? 'Hide project settings' : 'Edit project'}
      </Btn>
      <LinkButton to={`/audit?projectId=${encodeURIComponent(project.id)}`}>Audit log</LinkButton>
      <CreateBakeoffDialog
        projectId={project.id}
        agents={agentsList}
        projectAgents={projectAgents ?? []}
        repositories={repositoriesList}
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
            <span><span className="text-foreground/80">For:</span> {projectAudience(project, repositoriesList)}</span>
            <span><span className="text-foreground/80">Purpose:</span> {projectPurpose(project, repositoriesList)}</span>
          </div>
        )}
        actions={createActions}
        metrics={(
          <>
            <MetricPill label="running" value={liveRuns} tone="info" title="Project-scoped attempts." />
            <MetricPill label="awaiting" value={awaitingRuns} tone="accent" title="Project-scoped attempts." />
            <MetricPill label="failed history" value={failedLineages} tone="warn" title="Project-scoped attempts." />
            <MetricPill label="done" value={doneRuns} tone="ok" title="Project-scoped attempts." />
            <MetricPill label="tracked spend" value={costCoverageValue(costCoverage)} title="Project-scoped attempts." />
            <MetricPill label="cost gaps" value={costGapCount} tone={costGapCount > 0 ? 'warn' : 'default'} title={costGapDetail || undefined} />
          </>
        )}
      />

      <div className="space-y-6">
        <ProjectContextSection project={project} repositories={repositoriesList} />

        <ProjectScopeSection
          repositories={repositoriesList}
          fallbackRepos={project.repos}
          specCount={totalSpecs}
          taskCount={totalTasks}
          attemptCount={totalRuns}
          action={<AddRepositoryDialog projectId={project.id} />}
        />

        {settingsOpen && (
          <ProjectSettingsPanel
            project={project}
            inferredPurpose={projectPurpose(project, repositoriesList)}
            inferredAudience={projectAudience(project, repositoriesList)}
            onRenamed={(projectName) => navigate(`/${encodeURIComponent(projectName)}`)}
          />
        )}

        <ProjectSpecsSection
          projectName={project.name}
          specs={specsList}
          tasks={tasksList}
          runs={projectRuns}
          agents={agentsList}
          repositories={repositoriesList}
        />

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
              specs={specsList}
              agents={agentsList}
              projectAgents={projectAgents ?? []}
          />
        )}

        <ProjectAgentsPanel
          projectId={project.id}
          agents={agentsList}
          projectAgents={projectAgents ?? []}
          projectRuns={projectRuns}
          navigate={navigate}
        />
      </div>
    </Page>
  )
}

function ProjectDetailLoading({ projectName }: { projectName: string }) {
  return (
    <Page maxWidth={1480}>
      <PageHeader
        eyebrow="Project"
        title={projectName}
        icon={<FolderOpen className="h-4 w-4" />}
        subtitle={<Mono size={12} color={tokens.dim}>Loading project data...</Mono>}
      />
      <div className="space-y-6" aria-label="Loading project data">
        <div className="shimmer h-28 rounded-lg border border-border/20 bg-card/30" />
        <div className="shimmer h-36 rounded-lg border border-border/20 bg-card/30" />
        <div className="shimmer h-56 rounded-lg border border-border/20 bg-card/30" />
      </div>
    </Page>
  )
}

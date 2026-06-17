import { isAbsolute, normalize as normalizePath, resolve as resolvePath } from 'node:path'

import type { ConfigResource, Repository } from './resource-types.js'
import type { Agent, Project, ProjectAgent, Spec, Task } from './types.js'
import type { PrerequisiteIssue, RepairCheckStatus, RepairHostChecks } from './repair-types.js'
import { recordRef, repairItem } from './repair-utils.js'
import {
  blank,
  failed,
  findResource,
  providerForAgent,
  pushFailedCheck,
  refIssue,
} from './repair-readiness-helpers.js'
import {
  dataDirItem,
  gitItem,
  githubAuthItem,
  localAppItem,
  localGitItem,
  missingGithubRemoteItem,
  missingRemoteItem,
  needsOperatorItem,
  noAgentsItem,
  projectIssue,
  providerAuthItem,
  telegramItem,
  unsupportedHarnessItem,
  workflowRefItem,
  workflowValidationItem,
} from './repair-readiness-items.js'

export interface RepairReadinessInput {
  projects: Project[]
  repositoriesByProjectId: ReadonlyMap<string, Repository[]>
  projectAgents: ProjectAgent[]
  agents: Agent[]
  configResources: ConfigResource[]
  specs?: Spec[]
  tasks?: Task[]
  host?: RepairHostChecks
  dispatcher?: { enabled: boolean; running: boolean; adapterCount: number; adapters?: string[] }
  queue?: { needsOperator?: number }
  telegram?: { error?: string; channelRef?: string }
  requirements?: {
    remoteProjectIds?: ReadonlySet<string>
    githubProjectIds?: ReadonlySet<string>
    adapterNames?: ReadonlySet<string>
  }
}

export function buildReadinessRepairItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  return [
    ...factoryItems(input),
    ...projectItems(input),
    ...repositoryItems(input),
    ...agentItems(input),
    ...workflowItems(input),
    ...specStartItems(input),
  ]
}

function factoryItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const items: PrerequisiteIssue[] = []
  const dispatcher = input.dispatcher
  if (dispatcher != null && !dispatcher.enabled) {
    items.push(repairItem({
      id: 'factory:dispatcher-disabled',
      area: 'factory_setup',
      severity: 'blocker',
      title: 'Dispatcher is disabled',
      reason: 'The factory dispatcher is turned off, so ready tasks never start attempts automatically.',
      suggestedAction: 'Restart the Ductum API with dispatch enabled so ready tasks auto-dispatch.',
      record: recordRef('Factory', null, 'Ductum'),
      field: { path: 'factory.dispatch.enabled', label: 'Factory Activity dispatch', value: false },
      status: 'missing',
      href: '/settings',
      linkLabel: 'Open app settings',
    }))
  } else if (dispatcher != null && !dispatcher.running) {
    items.push(repairItem({
      id: 'factory:dispatcher-stopped',
      area: 'factory_setup',
      severity: 'attention',
      title: 'Dispatcher is not running',
      reason: 'The dispatcher is enabled but is not currently running, so queued work is not advancing.',
      suggestedAction: 'Restart the Ductum API to resume auto-dispatch.',
      record: recordRef('Factory', null, 'Ductum'),
      field: { path: 'factory.dispatch.running', label: 'Factory Activity running', value: false },
      status: 'unknown',
      href: '/settings',
      linkLabel: 'Open app settings',
    }))
  }

  if (input.agents.length === 0) items.push(noAgentsItem())
  pushFailedCheck(items, input.host?.git, gitItem)
  pushFailedCheck(items, input.host?.factoryDataDir, dataDirItem)
  pushFailedCheck(items, input.host?.localApp, localAppItem)
  if (input.telegram?.error != null) items.push(telegramItem(input.telegram))
  if ((input.queue?.needsOperator ?? 0) > 0) items.push(needsOperatorItem(input.queue!.needsOperator!))
  return items
}

function projectItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const assignments = new Map<string, ProjectAgent[]>()
  for (const assignment of input.projectAgents) {
    const list = assignments.get(assignment.projectId) ?? []
    list.push(assignment)
    assignments.set(assignment.projectId, list)
  }
  return input.projects.flatMap((project) => {
    const issues: PrerequisiteIssue[] = []
    if ((input.repositoriesByProjectId.get(project.id) ?? []).length === 0) {
      issues.push(projectIssue(project, 'No repositories are configured', 'Add at least one Repository to this Project.', 'repositories', '(missing)'))
    }
    if ((assignments.get(project.id) ?? []).length === 0) {
      issues.push(projectIssue(project, 'No agents are assigned', 'Assign a builder agent to this Project.', 'agents', '(missing)'))
    }
    return issues
  })
}

function repositoryItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const items: PrerequisiteIssue[] = []
  for (const project of input.projects) {
    const remoteRequired = input.requirements?.remoteProjectIds?.has(project.id) === true
    const githubRequired = input.requirements?.githubProjectIds?.has(project.id) === true
    for (const repo of input.repositoriesByProjectId.get(project.id) ?? []) {
      if (remoteRequired && blank(repo.spec.remoteUrl)) items.push(missingRemoteItem(project, repo))
      if (githubRequired && repo.readiness.github.state !== 'configured') items.push(missingGithubRemoteItem(project, repo))
      const localGit = input.host?.repositories?.[repo.id]?.localGit
      if (repo.spec.localPath != null && localGit != null && failed(localGit)) {
        items.push(localGitItem(project, repo, localGit))
      }
      if (githubRequired && input.host?.github != null && failed(input.host.github)) {
        items.push(githubAuthItem(project, repo, input.host.github))
      }
    }
  }
  return items
}

function agentItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const resources = input.configResources
  const adapters = input.requirements?.adapterNames
  const items: PrerequisiteIssue[] = []
  const emittedProviders = new Set<string>()
  for (const agent of input.agents) {
    for (const issue of agentRefIssues(agent, resources)) items.push(issue)
    if (adapters != null && !adapters.has(agent.harness)) items.push(unsupportedHarnessItem(agent))
    const provider = providerForAgent(agent, resources)
    if (provider == null || emittedProviders.has(provider)) continue
    emittedProviders.add(provider)
    const status = input.host?.providerAuth?.[provider]
    if (status != null && failed(status)) items.push(providerAuthItem(provider, status))
  }
  return items
}

function workflowItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const items: PrerequisiteIssue[] = []
  const workflowResources = input.configResources.filter((resource) => resource.kind === 'WorkflowProfile')
  for (const project of input.projects) {
    const ref = project.config.workflowProfile
    if (ref == null) continue
    const resource = resolveProjectWorkflowRecord(workflowResources, project, projectRepoRoots(project, input))
    if (resource == null) {
      items.push(workflowRefItem(project, ref))
      continue
    }
    // Target the validity blocker at the project that references the invalid
    // workflow so unrelated projects stay dispatch-eligible.
    const status = input.host?.workflows?.[resource.id]
    if (status != null && failed(status)) items.push(workflowValidationItem(resource, status, project))
  }
  return items
}

// project.config.workflowProfile is a path under the current contract (the API
// normalizes it to an absolute path and the runtime loads it as a path). Resolve
// it to a WorkflowProfile record: first by record identity (name/id) for forward
// compatibility with the future record-id migration (P2), then by path, matching
// the record's possibly-relative spec.path normalized through the project repo
// roots. Does not mutate the project field or revive ductum.yaml as authority.
function resolveProjectWorkflowRecord(
  workflowResources: ConfigResource[],
  project: Project,
  repoRoots: string[],
): ConfigResource | null {
  const ref = project.config.workflowProfile
  if (ref == null) return null
  const byRecord = findResource(workflowResources, ref, project.id)
  if (byRecord != null) return byRecord
  const refForms = absolutePathForms(ref, repoRoots)
  for (const resource of workflowResources) {
    if (resource.projectId != null && resource.projectId !== project.id) continue
    const recordPath = (resource.spec as { path?: unknown }).path
    if (typeof recordPath !== 'string' || recordPath === '') continue
    if (recordPath === ref) return resource
    for (const form of absolutePathForms(recordPath, repoRoots)) {
      if (refForms.has(form)) return resource
    }
  }
  return null
}

function projectRepoRoots(project: Project, input: RepairReadinessInput): string[] {
  const repos = input.repositoriesByProjectId.get(project.id) ?? []
  return repos
    .map((repo) => repo.spec.localPath)
    .filter((path): path is string => typeof path === 'string' && path !== '')
}

function absolutePathForms(target: string, repoRoots: string[]): Set<string> {
  if (isAbsolute(target)) return new Set([normalizePath(target)])
  const forms = new Set(repoRoots.map((root) => resolvePath(root, target)))
  forms.add(resolvePath(target))
  return forms
}

function specStartItems(input: RepairReadinessInput): PrerequisiteIssue[] {
  const issuesByProject = new Set(
    repositoryItems(input)
      .filter((item) => item.severity === 'blocker')
      .map((item) => item.target?.projectId)
      .filter((id): id is string => id != null),
  )
  if (issuesByProject.size === 0) return []
  const projectById = new Map(input.projects.map((project) => [project.id, project]))
  const specById = new Map((input.specs ?? []).map((spec) => [spec.id, spec]))
  return (input.tasks ?? [])
    .filter((task) => task.status === 'ready')
    .flatMap((task) => {
      const spec = specById.get(task.specId)
      const project = spec == null ? null : projectById.get(spec.projectId)
      if (spec == null || project == null || !issuesByProject.has(project.id)) return []
      return [repairItem({
        id: `spec-start:${task.id}:repository-readiness`,
        area: 'spec_start',
        severity: 'blocker',
        title: 'Task cannot start until its repository is ready',
        reason: `Task ${task.name} is ready, but Project ${project.name} has repository readiness blockers.`,
        suggestedAction: 'Open Repair for the Repository readiness items, fix them, then start the task again.',
        record: recordRef('Task', task.id, task.name),
        field: { path: `tasks.${task.id}.repository`, label: 'Task Repository', value: task.repositoryId ?? task.repos[0] },
        status: 'missing',
        target: { projectId: project.id, projectName: project.name, specId: spec.id, specName: spec.name, taskId: task.id, taskName: task.name },
      })]
    })
}

function agentRefIssues(agent: Agent, resources: ConfigResource[]): PrerequisiteIssue[] {
  const refs = agent.resourceRefs ?? {}
  return [
    refIssue(agent, 'modelRef', 'Model', refs.modelRef, resources),
    refIssue(agent, 'harnessRef', 'Harness', refs.harnessRef, resources),
    refIssue(agent, 'sandboxRef', 'SandboxProfile', refs.sandboxRef, resources),
    refIssue(agent, 'workflowProfileRef', 'WorkflowProfile', refs.workflowProfileRef, resources),
  ].filter((item): item is PrerequisiteIssue => item != null)
}

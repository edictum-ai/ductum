import type { ConfigResource, Repository } from './resource-types.js'
import type { Agent, Project } from './types.js'
import type { PrerequisiteIssue, RepairCheckStatus } from './repair-types.js'
import { agentPath, projectPath, recordRef, repairItem, repositoryPath } from './repair-utils.js'

export function noAgentsItem(): PrerequisiteIssue {
  return repairItem({
    id: 'factory:no-agents',
    area: 'agent_readiness',
    severity: 'blocker',
    title: 'No agents are registered',
    reason: 'No factory agent is configured, so no project can be assigned a worker or start an attempt.',
    suggestedAction: 'Add an agent in Factory Settings, then assign it to a project.',
    record: recordRef('Factory', null, 'Factory agents'),
    field: { path: 'factory.agents', label: 'Agent roster', value: 0 },
    status: 'missing',
    href: '/settings',
    linkLabel: 'Open agent settings',
  })
}

export function projectIssue(
  project: Project,
  title: string,
  action: string,
  field: 'repositories' | 'agents',
  value: unknown,
): PrerequisiteIssue {
  return repairItem({
    id: `project:${project.id}:${field}:missing`,
    area: 'project_readiness',
    severity: 'blocker',
    title,
    reason: `Project ${project.name} cannot dispatch work until ${field} are configured.`,
    suggestedAction: action,
    record: recordRef('Project', project.id, project.name),
    field: { path: projectPath(project.name, field), label: field === 'agents' ? 'Project agents' : 'Project repositories', value },
    status: 'missing',
    target: { projectId: project.id, projectName: project.name },
    href: '/projects',
    linkLabel: 'Open projects',
  })
}

export function missingRemoteItem(project: Project, repo: Repository): PrerequisiteIssue {
  return repairItem({
    id: `repository:${repo.id}:remoteUrl:missing`,
    area: 'repository_readiness',
    severity: 'blocker',
    title: 'Repository remote is required',
    reason: `Project ${project.name} is using a workflow that needs remote repository support, but Repository ${repo.name} has no remote URL.`,
    suggestedAction: 'Add a remote URL through Project Repository settings.',
    record: recordRef('Repository', repo.id, repo.name),
    field: { path: repositoryPath(project.name, repo.name, 'remoteUrl'), label: 'Repository remote URL', value: repo.spec.remoteUrl },
    status: 'missing',
    target: repositoryTarget(project, repo),
  })
}

export function missingGithubRemoteItem(project: Project, repo: Repository): PrerequisiteIssue {
  return repairItem({
    id: `repository:${repo.id}:github-remote:missing`,
    area: 'repository_readiness',
    severity: 'blocker',
    title: 'GitHub remote is required',
    reason: `Project ${project.name} requires GitHub-backed external review or remote shipping, but Repository ${repo.name} is not configured as a GitHub remote.`,
    suggestedAction: 'Set the Repository remote URL to a GitHub repository, or use a local-only workflow.',
    record: recordRef('Repository', repo.id, repo.name),
    field: { path: repositoryPath(project.name, repo.name, 'remoteUrl'), label: 'GitHub remote URL', value: repo.spec.remoteUrl },
    status: repo.spec.remoteUrl == null ? 'missing' : 'configured',
    target: repositoryTarget(project, repo),
  })
}

export function localGitItem(project: Project, repo: Repository, status: RepairCheckStatus): PrerequisiteIssue {
  return repairItem({
    id: `repository:${repo.id}:local-git:${status.state}`,
    area: 'repository_readiness',
    severity: 'blocker',
    title: 'Repository is not a local Git checkout',
    reason: status.detail ?? `Repository ${repo.name} local path is not an initialized Git repository.`,
    suggestedAction: 'Run git init in the repository path or choose a different local repository path.',
    record: recordRef('Repository', repo.id, repo.name),
    field: { path: repositoryPath(project.name, repo.name, 'localPath'), label: 'Repository local path', value: repo.spec.localPath },
    status: status.state,
    target: repositoryTarget(project, repo),
  })
}

export function githubAuthItem(project: Project, repo: Repository, status: RepairCheckStatus): PrerequisiteIssue {
  return repairItem({
    id: `repository:${repo.id}:github-auth:${status.state}`,
    area: 'repository_readiness',
    severity: 'blocker',
    title: 'GitHub auth is missing',
    reason: status.detail ?? 'GitHub CLI authentication is required before this remote workflow can start attempts.',
    suggestedAction: 'Run gh auth login, then retry the attempt.',
    record: recordRef('Repository', repo.id, repo.name),
    field: { path: 'host.github.auth', label: 'GitHub CLI auth', value: status.label ?? status.state },
    status: status.state,
    target: repositoryTarget(project, repo),
  })
}

export function providerAuthItem(provider: string, status: RepairCheckStatus): PrerequisiteIssue {
  return repairItem({
    id: `provider:${provider}:auth:${status.state}`,
    area: 'provider_auth',
    severity: 'blocker',
    title: `${providerLabel(provider)} auth is missing`,
    reason: status.detail ?? `${providerLabel(provider)} authentication was not detected for configured agents.`,
    suggestedAction: providerAction(provider),
    record: recordRef('Provider', `provider:${provider}`, providerLabel(provider)),
    field: {
      path: `providers.${provider}.auth`,
      label: `${providerLabel(provider)} auth`,
      value: providerAuthStatusValue(status),
    },
    status: status.state,
    target: { providerId: provider },
  })
}

export function agentProviderAuthItem(agent: Agent, provider: string, status: RepairCheckStatus): PrerequisiteIssue {
  return repairItem({
    id: `agent:${agent.id}:provider:${provider}:auth:${status.state}`,
    area: 'provider_auth',
    severity: 'blocker',
    title: `${agent.name} ${providerLabel(provider)} auth is missing`,
    reason: status.detail ?? `${providerLabel(provider)} authentication was not detected for agent ${agent.name}.`,
    suggestedAction: providerAction(provider),
    record: recordRef('Agent', agent.id, agent.name),
    field: {
      path: agentPath(agent.name, 'auth'),
      label: `${providerLabel(provider)} auth`,
      value: providerAuthStatusValue(status),
    },
    status: status.state,
    target: { agentId: agent.id, agentName: agent.name, providerId: provider },
  })
}

export function unsupportedHarnessItem(agent: Agent): PrerequisiteIssue {
  return repairItem({
    id: `agent:${agent.id}:harness:unsupported`,
    area: 'agent_readiness',
    severity: 'blocker',
    title: `Agent ${agent.name} uses an unavailable harness`,
    reason: `Agent ${agent.name} is configured for harness ${agent.harness}, but that harness adapter is not loaded.`,
    suggestedAction: 'Start the API with the required harness available, or choose a loaded Harness in Factory Settings.',
    record: recordRef('Agent', agent.id, agent.name),
    field: { path: agentPath(agent.name, 'harness'), label: 'Agent harness', value: agent.harness },
    status: 'missing',
    target: { agentId: agent.id, agentName: agent.name },
  })
}

export function workflowRefItem(project: Project, ref: string): PrerequisiteIssue {
  return repairItem({
    id: `project:${project.id}:workflowProfile:missing`,
    area: 'workflow_validity',
    severity: 'blocker',
    title: 'Project workflow is missing',
    reason: `Project ${project.name} references Workflow ${ref}, but no matching Workflow record exists.`,
    suggestedAction: 'Choose an existing Workflow in Project settings.',
    record: recordRef('Project', project.id, project.name),
    field: { path: projectPath(project.name, 'workflow'), label: 'Project Workflow', value: ref },
    status: 'missing',
    target: { projectId: project.id, projectName: project.name },
  })
}

export function workflowAmbiguousRefItem(project: Project, ref: string): PrerequisiteIssue {
  return repairItem({
    id: `project:${project.id}:workflowProfile:ambiguous`,
    area: 'workflow_validity',
    severity: 'blocker',
    title: 'Project workflow is ambiguous',
    reason: `Project ${project.name} workflowProfile ${ref} matches multiple WorkflowProfile records.`,
    suggestedAction: 'Choose one WorkflowProfile record in Project settings so the Project stores a stable workflowProfileRef.',
    record: recordRef('Project', project.id, project.name),
    field: { path: projectPath(project.name, 'workflowProfile'), label: 'Project workflowProfile', value: ref },
    status: 'unknown',
    issueCode: 'workflow_profile_legacy_ambiguous',
    target: { projectId: project.id, projectName: project.name },
  })
}

export function workflowValidationItem(
  resource: ConfigResource,
  status: RepairCheckStatus,
  project: Project,
): PrerequisiteIssue {
  return repairItem({
    id: `workflow:${resource.id}:validation:${status.state}`,
    area: 'workflow_validity',
    severity: 'blocker',
    title: `Workflow ${resource.name} is invalid`,
    reason: status.detail ?? `Workflow ${resource.name} failed validation.`,
    suggestedAction: 'Open Factory Settings and choose a valid Workflow path.',
    record: recordRef('Workflow', resource.id, resource.name),
    field: { path: `workflows.${resource.name}.path`, label: 'Workflow path', value: (resource.spec as { path?: unknown }).path },
    status: status.state,
    target: { projectId: project.id, projectName: project.name },
  })
}

export function gitItem(status: RepairCheckStatus): PrerequisiteIssue {
  return hostItem('host:git:missing', 'repository_readiness', 'Git is not available', status, 'host.git', 'Git executable', 'Install Git and ensure git is on PATH.')
}

export function dataDirItem(status: RepairCheckStatus): PrerequisiteIssue {
  return hostItem('factory:data-dir:writable', 'factory_setup', 'Factory data directory is not writable', status, 'factory.dataDir', 'Factory data directory', 'Fix directory permissions or choose a writable Factory data directory.')
}

export function localAppItem(status: RepairCheckStatus): PrerequisiteIssue {
  return hostItem('factory:local-app-port', 'factory_setup', 'Local app port is not reachable', status, 'factory.localAppPort', 'Local app port', 'Start Ductum on a reachable local port, or choose a different port.')
}

export function telegramItem(input: { error?: string; channelRef?: string }): PrerequisiteIssue {
  return repairItem({
    id: 'factory:telegram-error',
    area: 'factory_setup',
    severity: 'attention',
    title: 'Notification channel error',
    reason: `The Telegram notification channel reported an error: ${input.error ?? 'unknown error'}`,
    suggestedAction: 'Open Factory Settings, then re-check the Telegram notification channel.',
    record: recordRef('Notification channel', input.channelRef ?? null, input.channelRef ?? 'Telegram notification channel'),
    field: { path: 'notificationChannels.telegram.status', label: 'Telegram channel status', value: input.error },
    status: 'unknown',
    href: '/settings',
    linkLabel: 'Open notification settings',
  })
}

export function needsOperatorItem(count: number): PrerequisiteIssue {
  return repairItem({
    id: 'attempt-recovery:needs-operator',
    area: 'attempt_recovery',
    severity: 'attention',
    title: `${count} attempt${count === 1 ? '' : 's'} stopped and need a decision`,
    reason: `${count} failed or stalled attempt${count === 1 ? '' : 's'} on still-active task${count === 1 ? ' has' : 's have'} no live sibling working the task.`,
    suggestedAction: 'Open Factory Activity, then retry or close each stopped attempt.',
    record: recordRef('Factory Activity', null, 'Needs-operator attempts'),
    field: { path: 'attempts.terminalState', label: 'Attempt terminal state', value: count },
    status: 'unknown',
    href: '/activity',
    linkLabel: 'Open Factory Activity',
  })
}

function hostItem(
  id: string,
  area: PrerequisiteIssue['area'],
  title: string,
  status: RepairCheckStatus,
  path: string,
  label: string,
  suggestedAction: string,
): PrerequisiteIssue {
  return repairItem({
    id,
    area,
    severity: 'blocker',
    title,
    reason: status.detail ?? `${label} check failed.`,
    suggestedAction,
    record: recordRef('Factory', null, 'Host prerequisites'),
    field: { path, label, value: status.label ?? status.state },
    status: status.state,
  })
}

function providerAuthStatusValue(status: RepairCheckStatus): string {
  return status.state
}

function repositoryTarget(project: Project, repo: Repository) {
  return {
    projectId: project.id,
    projectName: project.name,
    repositoryId: repo.id,
    repositoryName: repo.name,
  }
}

function providerLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'anthropic') return 'Anthropic'
  if (provider === 'zai') return 'Z.AI'
  return provider
}

function providerAction(provider: string): string {
  if (provider === 'openai') return 'Configure an OpenAI API credential, then retry.'
  if (provider === 'anthropic') return 'Configure an Anthropic credential or sign in with Claude Code, then retry.'
  if (provider === 'zai') return 'Configure Z.AI provider auth for the selected agent, then retry.'
  return 'Configure provider authentication, then retry.'
}

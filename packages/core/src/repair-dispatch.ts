import type { Agent, Project, Spec, Task } from './types.js'
import type { PrerequisiteIssue } from './repair-types.js'
import { buildRepairReport, type BuildRepairReportInput } from './repair-report.js'
import { providerForAgent } from './repair-readiness-helpers.js'

export class PrerequisiteCheckError extends Error {
  constructor(readonly issues: PrerequisiteIssue[]) {
    super(formatPrerequisiteBlockMessage(issues))
    this.name = 'PrerequisiteCheckError'
  }
}

export interface TaskPrerequisiteInput extends BuildRepairReportInput {
  task: Task
  agent: Agent
}

export function buildTaskPrerequisiteIssues(input: TaskPrerequisiteInput): PrerequisiteIssue[] {
  const spec = input.specs?.find((item) => item.id === input.task.specId) ?? null
  const project = spec == null ? null : input.projects.find((item) => item.id === spec.projectId) ?? null
  const provider = providerForAgent(input.agent, input.configResources)
  return buildRepairReport(input).items.filter((item) =>
    item.severity === 'blocker' && blocksTask(item, {
      agent: input.agent,
      project,
      spec,
      task: input.task,
      provider,
    }))
}

export function assertTaskPrerequisites(input: TaskPrerequisiteInput): void {
  const issues = buildTaskPrerequisiteIssues(input)
  if (issues.length > 0) throw new PrerequisiteCheckError(issues)
}

export function formatPrerequisiteBlockMessage(issues: readonly PrerequisiteIssue[]): string {
  const first = issues[0]
  if (first == null) return 'Attempt start blocked by prerequisite checks.'
  return [
    'Attempt start blocked by prerequisite checks.',
    `${first.record.type}${first.record.name == null ? '' : ` ${first.record.name}`}`,
    `field ${first.field.path} (${first.field.label})`,
    `is ${first.field.value ?? first.status}; blocks ${first.blocks}`,
    `Suggested action: ${first.suggestedAction}`,
  ].join(' ')
}

function blocksTask(
  issue: PrerequisiteIssue,
  input: { agent: Agent; project: Project | null; spec: Spec | null; task: Task; provider: string | null },
): boolean {
  if (issue.area === 'factory_setup') return true
  if (issue.area === 'provider_auth') return input.provider != null && issue.target?.providerId === input.provider
  if (issue.target?.agentId != null) return issue.target.agentId === input.agent.id
  if (issue.target?.taskId != null) return issue.target.taskId === input.task.id
  if (issue.target?.specId != null) return issue.target.specId === input.spec?.id
  if (issue.target?.projectId != null) return issue.target.projectId === input.project?.id
  return issue.area === 'repository_readiness' || issue.area === 'agent_readiness' || issue.area === 'workflow_validity'
}

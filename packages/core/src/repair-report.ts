import type { ConfigResource } from './resource-types.js'
import type { Agent, Project, ProjectAgent } from './types.js'
import {
  REPAIR_AREA_BLOCKS,
  REPAIR_AREA_LABEL,
  REPAIR_AREA_ORDER,
  type PrerequisiteIssue,
  type ProjectDispatchEligibility,
  type RepairArea,
  type RepairGroup,
  type RepairReport,
  type RepairSummary,
} from './repair-types.js'
import { buildDispatchSkipRepairItems } from './repair-dispatch-skips.js'
import { buildExecutionRepairItems, type RepairExecutionInput } from './repair-execution.js'
import { buildReadinessRepairItems, type RepairReadinessInput } from './repair-readiness.js'
import { providerForAgent } from './repair-readiness-helpers.js'
import type { TaskDispatchSkip } from './task-dispatch-skip-types.js'

export interface BuildRepairReportInput extends RepairReadinessInput {
  generatedAt: string
  execution?: RepairExecutionInput
  dispatchSkips?: readonly TaskDispatchSkip[]
}

const DISPATCH_BLOCKING_AREAS = new Set<RepairArea>([
  'factory_setup',
  'project_readiness',
  'repository_readiness',
  'agent_readiness',
  'provider_auth',
  'workflow_validity',
  'spec_start',
])

const GLOBAL_DISPATCH_BLOCKING_AREAS = new Set<RepairArea>([
  'factory_setup',
  'repository_readiness',
  'agent_readiness',
  'workflow_validity',
])

export function buildRepairReport(input: BuildRepairReportInput): RepairReport {
  const items = sortItems([
    ...buildReadinessRepairItems(input),
    ...buildDispatchSkipRepairItems(input),
    ...buildExecutionRepairItems(input.execution),
  ])
  return {
    generatedAt: input.generatedAt,
    items,
    groups: groupRepairItems(items),
    summary: repairSummary(items),
    projectDispatch: projectDispatchEligibility({
      projects: input.projects,
      items,
      projectAgents: input.projectAgents,
      agents: input.agents,
      configResources: input.configResources,
    }),
  }
}

export function groupRepairItems(items: readonly PrerequisiteIssue[]): RepairGroup[] {
  const byArea = new Map<RepairArea, PrerequisiteIssue[]>()
  for (const item of items) {
    const list = byArea.get(item.area) ?? []
    list.push(item)
    byArea.set(item.area, list)
  }
  const groups: RepairGroup[] = []
  for (const area of REPAIR_AREA_ORDER) {
    const list = byArea.get(area)
    if (list == null || list.length === 0) continue
    groups.push({ area, label: REPAIR_AREA_LABEL[area], blocks: REPAIR_AREA_BLOCKS[area], items: sortItems(list) })
  }
  return groups
}

export function repairSummary(items: readonly PrerequisiteIssue[]): RepairSummary {
  const byArea = Object.fromEntries(REPAIR_AREA_ORDER.map((area) => [area, 0])) as Record<RepairArea, number>
  for (const item of items) byArea[item.area] += 1
  return {
    total: items.length,
    blockers: items.filter((item) => item.severity === 'blocker').length,
    attention: items.filter((item) => item.severity === 'attention').length,
    byArea,
  }
}

export function projectDispatchEligibility(input: {
  projects: readonly Project[]
  items: readonly PrerequisiteIssue[]
  projectAgents?: readonly ProjectAgent[]
  agents?: readonly Agent[]
  configResources?: readonly ConfigResource[]
}): ProjectDispatchEligibility[] {
  return input.projects.map((project) => {
    const scope = projectScope(project, input.projectAgents ?? [], input.agents ?? [], input.configResources ?? [])
    const blockers = input.items.filter((item) => dispatchBlockerAppliesToProject(item, project, scope))
    return {
      projectId: project.id,
      projectName: project.name,
      eligible: blockers.length === 0,
      blockerIds: blockers.map((item) => item.id),
    }
  })
}

function dispatchBlockerAppliesToProject(
  item: PrerequisiteIssue,
  project: Project,
  scope: { agentIds: ReadonlySet<string>; providers: ReadonlySet<string> },
): boolean {
  if (item.severity !== 'blocker' || !DISPATCH_BLOCKING_AREAS.has(item.area)) return false
  if (item.target?.projectId != null) return item.target.projectId === project.id
  if (item.target?.agentId != null) return scope.agentIds.has(item.target.agentId)
  if (item.area === 'provider_auth' && item.target?.providerId != null) {
    return scope.providers.has(item.target.providerId)
  }
  return isUntargeted(item) && GLOBAL_DISPATCH_BLOCKING_AREAS.has(item.area)
}

function projectScope(
  project: Project,
  projectAgents: readonly ProjectAgent[],
  agents: readonly Agent[],
  configResources: readonly ConfigResource[],
): { agentIds: ReadonlySet<string>; providers: ReadonlySet<string> } {
  const agentIds = new Set(
    projectAgents
      .filter((assignment) => assignment.projectId === project.id)
      .map((assignment) => assignment.agentId),
  )
  const providers = new Set<string>()
  for (const agent of agents) {
    if (!agentIds.has(agent.id)) continue
    const provider = providerForAgent(agent, configResources)
    if (provider != null) providers.add(provider)
  }
  return { agentIds, providers }
}

function isUntargeted(item: PrerequisiteIssue): boolean {
  return item.target == null || Object.values(item.target).every((value) => value == null)
}

export function sortItems<T extends PrerequisiteIssue>(items: readonly T[]): T[] {
  return [...items].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity) ||
    REPAIR_AREA_ORDER.indexOf(a.area) - REPAIR_AREA_ORDER.indexOf(b.area) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id),
  )
}

function severityRank(severity: PrerequisiteIssue['severity']): number {
  return severity === 'blocker' ? 0 : 1
}

import { resolveModelEntry } from './model-registry.js'
import type { ConfigResource, ModelSpec } from './resource-types.js'
import type { Agent } from './types.js'
import type { PrerequisiteIssue, RepairCheckStatus } from './repair-types.js'
import { agentPath, recordRef, repairItem } from './repair-utils.js'

export function providerForAgent(agent: Agent, resources: readonly ConfigResource[]): string | null {
  const resource = resolveModelResource(agent, resources)
  const spec = resource?.spec as Partial<ModelSpec> | undefined
  if (typeof spec?.provider === 'string' && spec.provider.trim() !== '') return spec.provider.trim()
  if (typeof agent.providerId === 'string' && agent.providerId.trim() !== '') return agent.providerId.trim()
  return resolveModelEntry(agent.model)?.provider ?? null
}

function resolveModelResource(agent: Agent, resources: readonly ConfigResource[]): ConfigResource | null {
  const ref = agent.resourceRefs?.modelRef?.trim()
  const models = resources.filter((item) => item.kind === 'Model')
  if (ref != null && ref !== '') {
    const explicit = findModelResourceByRef(models, ref)
    if (explicit != null) return explicit
  }
  return findModelResource(models, agent.model)
}

function findModelResource(resources: readonly ConfigResource[], model: string): ConfigResource | null {
  return resources.find((resource) => {
    const spec = resource.spec as Partial<ModelSpec>
    return resource.name === model || spec.modelId === model
  }) ?? null
}

function findModelResourceByRef(resources: readonly ConfigResource[], ref: string): ConfigResource | null {
  return findResource(resources, ref, null) ?? resources.find((resource) => {
    const spec = resource.spec as Partial<ModelSpec>
    return spec.modelId === ref
  }) ?? null
}

export function findResource(resources: readonly ConfigResource[], ref: string, projectId: string | null): ConfigResource | null {
  const byId = resources.find((resource) => resource.id === ref)
  if (byId != null) return byId
  const projectMatch = projectId == null
    ? null
    : resources.find((resource) => resource.name === ref && resource.projectId === projectId)
  if (projectMatch != null) return projectMatch
  return resources.find((resource) => resource.name === ref && resource.projectId == null) ?? null
}

export function pushFailedCheck(
  items: PrerequisiteIssue[],
  status: RepairCheckStatus | undefined,
  build: (status: RepairCheckStatus) => PrerequisiteIssue,
): void {
  if (status != null && failed(status)) items.push(build(status))
}

export function failed(status: RepairCheckStatus): boolean {
  return status.state === 'missing' || status.state === 'unknown'
}

export function blank(value: string | null | undefined): boolean {
  return value == null || value.trim() === ''
}

export function refIssue(
  agent: Agent,
  field: keyof NonNullable<Agent['resourceRefs']>,
  kind: ConfigResource['kind'],
  ref: string | undefined,
  resources: readonly ConfigResource[],
): PrerequisiteIssue | null {
  if (ref == null || findResource(resources.filter((resource) => resource.kind === kind), ref, null) != null) return null
  return repairItem({
    id: `agent:${agent.id}:${field}:missing`,
    area: field === 'workflowProfileRef' ? 'workflow_validity' : 'agent_readiness',
    severity: 'blocker',
    title: `Agent ${agent.name} references a missing ${kind}`,
    reason: `Agent ${agent.name} has ${field} "${ref}", but no matching ${kind} record exists.`,
    suggestedAction: `Open Factory Settings and choose an existing ${kind} for this agent.`,
    record: recordRef('Agent', agent.id, agent.name),
    field: { path: agentPath(agent.name, field), label: `${kind} reference`, value: ref },
    status: 'missing',
    target: { agentId: agent.id, agentName: agent.name },
  })
}

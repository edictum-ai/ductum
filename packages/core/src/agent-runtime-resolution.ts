import type { ConfigResource, ConfigResourceKind, ModelSpec, HarnessSpec, SandboxProfileSpec } from './resource-types.js'
import type { ConfigResourceRepo } from './repos/interfaces.js'
import type { Agent, ProjectId, RunSandboxProfileSnapshot } from './types.js'

export type AgentRuntimeResolutionErrorCode =
  | 'resource_not_found'
  | 'resource_wrong_kind'
  | 'resource_cross_project'
  | 'resource_ambiguous'
  | 'resource_malformed'
  | 'runtime_config_missing'
  | 'runtime_spec_missing'
  | 'unsupported_harness'

export class AgentRuntimeResolutionError extends Error {
  constructor(
    message: string,
    readonly code: AgentRuntimeResolutionErrorCode,
  ) {
    super(message)
    this.name = 'AgentRuntimeResolutionError'
  }
}

type AgentRuntimeShape = Pick<Agent, 'name' | 'model' | 'harness' | 'resourceRefs'>

export type ConfigResourceLookup = Pick<ConfigResourceRepo, 'get' | 'list'>

interface AgentRuntimeResolutionOptions {
  resolveSandboxRef?: boolean
}

export interface AgentRuntimeResolution<T extends AgentRuntimeShape> {
  agent: T
  modelResource: ConfigResource | null
  harnessResource: ConfigResource | null
  harnessSnapshot: RunHarnessResourceSnapshot | null
  sandboxResource: ConfigResource | null
  sandboxProfile: RunSandboxProfileSnapshot | null
}

export interface RunHarnessResourceSnapshot {
  id: ConfigResource['id']
  name: string
  projectId: ProjectId | null
  type: string
  spec: {
    type: string
    command?: string
    controlMode?: string
    supportedSandboxes?: string[]
  }
}

export function resolveAgentRuntimeDetails<T extends AgentRuntimeShape>(
  agent: T,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
  options: AgentRuntimeResolutionOptions = {},
): AgentRuntimeResolution<T> {
  const refs = agent.resourceRefs ?? {}
  let modelResource: ConfigResource | null = null
  let harnessResource: ConfigResource | null = null
  let harnessSnapshot: RunHarnessResourceSnapshot | null = null
  let sandboxResource: ConfigResource | null = null
  let sandboxProfile: RunSandboxProfileSnapshot | null = null
  let model = agent.model
  let harness = agent.harness
  if (refs.modelRef != null) {
    modelResource = resolveConfigRef(agent, 'modelRef', 'Model', refs.modelRef, projectId, resources)
    model = modelIdFromResource(agent, refs.modelRef, modelResource)
  }
  if (refs.harnessRef != null) {
    harnessResource = resolveConfigRef(agent, 'harnessRef', 'Harness', refs.harnessRef, projectId, resources)
    harnessSnapshot = harnessSnapshotFromResource(agent, refs.harnessRef, harnessResource)
    harness = harnessSnapshot.type as Agent['harness']
  }
  if (options.resolveSandboxRef !== false && refs.sandboxRef != null) {
    sandboxResource = resolveConfigRef(agent, 'sandboxRef', 'SandboxProfile', refs.sandboxRef, projectId, resources)
    sandboxProfile = sandboxProfileFromResource(agent, refs.sandboxRef, sandboxResource)
  }
  const runtimeAgent = model === agent.model && harness === agent.harness ? agent : { ...agent, model, harness }
  return { agent: runtimeAgent, modelResource, harnessResource, harnessSnapshot, sandboxResource, sandboxProfile }
}

export function resolveAgentSandboxProfileDetails(
  agent: Pick<Agent, 'name'> & { resourceRefs: { sandboxRef: string } },
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
): { profile: RunSandboxProfileSnapshot; resource: ConfigResource } {
  const ref = agent.resourceRefs.sandboxRef
  const resource = resolveConfigRef(agent, 'sandboxRef', 'SandboxProfile', ref, projectId, resources)
  return { profile: sandboxProfileFromResource(agent, ref, resource), resource }
}

function modelIdFromResource(
  agent: AgentRuntimeShape,
  ref: string,
  resource: ConfigResource,
): string {
  const spec = resource.spec as Partial<ModelSpec>
  if (typeof spec.modelId !== 'string' || spec.modelId.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} modelRef "${ref}" resolved to Model ${resource.name} without provider model ID spec.modelId`, 'resource_malformed')
  }
  return spec.modelId.trim()
}

function harnessSnapshotFromResource(
  agent: AgentRuntimeShape,
  ref: string,
  resource: ConfigResource,
): RunHarnessResourceSnapshot {
  const spec = normalizeHarnessSpec(agent, ref, resource.name, resource.spec)
  return {
    id: resource.id,
    name: resource.name,
    projectId: resource.projectId,
    type: spec.type,
    spec,
  }
}

function normalizeHarnessSpec(
  agent: AgentRuntimeShape,
  ref: string,
  resourceName: string,
  value: unknown,
): RunHarnessResourceSnapshot['spec'] {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} without an object spec`, 'resource_malformed')
  }
  const spec = value as Partial<HarnessSpec>
  if (typeof spec.type !== 'string' || spec.type.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} without Harness adapter type spec.type`, 'resource_malformed')
  }
  const out: RunHarnessResourceSnapshot['spec'] = { type: spec.type.trim() }
  if (spec.command != null) {
    if (typeof spec.command !== 'string') {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with non-string spec.command`, 'resource_malformed')
    }
    if (spec.command.trim() === '') {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with empty spec.command`, 'resource_malformed')
    }
    out.command = spec.command.trim()
  }
  if (spec.controlMode != null) {
    if (typeof spec.controlMode !== 'string') {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with non-string spec.controlMode`, 'resource_malformed')
    }
    if (spec.controlMode.trim() === '') {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with empty spec.controlMode`, 'resource_malformed')
    }
    out.controlMode = spec.controlMode.trim()
  }
  if (spec.supportedSandboxes != null) {
    if (!Array.isArray(spec.supportedSandboxes) || spec.supportedSandboxes.some((item) => typeof item !== 'string')) {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with invalid spec.supportedSandboxes`, 'resource_malformed')
    }
    const supportedSandboxes = spec.supportedSandboxes.map((item) => item.trim())
    if (supportedSandboxes.some((item) => item === '')) {
      throw new AgentRuntimeResolutionError(`Agent ${agent.name} harnessRef "${ref}" resolved to Harness ${resourceName} with empty spec.supportedSandboxes entry`, 'resource_malformed')
    }
    out.supportedSandboxes = supportedSandboxes
  }
  return out
}

function sandboxProfileFromResource(
  agent: Pick<Agent, 'name'>,
  ref: string,
  resource: ConfigResource,
): RunSandboxProfileSnapshot {
  const spec = resource.spec as Partial<SandboxProfileSpec>
  if (typeof spec.provider !== 'string' || spec.provider.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} sandboxRef "${ref}" resolved to SandboxProfile ${resource.name} without spec.provider`, 'resource_malformed')
  }
  if (typeof spec.mode !== 'string' || spec.mode.trim() === '') {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} sandboxRef "${ref}" resolved to SandboxProfile ${resource.name} without spec.mode`, 'resource_malformed')
  }
  const snapshotSpec = redactSandboxSnapshotSpec({
    ...(spec as Record<string, unknown>),
    provider: spec.provider.trim(),
    mode: spec.mode.trim(),
  })
  return {
    id: resource.id,
    name: resource.name,
    projectId: resource.projectId,
    provider: spec.provider.trim(),
    mode: spec.mode.trim(),
    spec: snapshotSpec,
  }
}

const SENSITIVE_SNAPSHOT_KEY_PATTERNS = [
  'accesskey',
  'apikey',
  'auth',
  'authorization',
  'bearer',
  'credential',
  'oauth',
  'password',
  'privatekey',
  'secret',
  'sessionkey',
  'signature',
  'token',
]

function redactSandboxSnapshotSpec(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveSnapshotKey(key)) continue
    out[key] = redactSandboxSnapshotValue(item)
  }
  return out
}

function isSensitiveSnapshotKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SENSITIVE_SNAPSHOT_KEY_PATTERNS.some((pattern) => normalized.includes(pattern))
}

function redactSandboxSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSandboxSnapshotValue)
  if (value == null || typeof value !== 'object') return value
  return redactSandboxSnapshotSpec(value as Record<string, unknown>)
}

export function resolveConfigRef(
  agent: Pick<Agent, 'name'>,
  field: 'modelRef' | 'harnessRef' | 'sandboxRef' | 'workflowProfileRef',
  expectedKind: ConfigResourceKind,
  ref: string,
  projectId: ProjectId | null,
  resources: ConfigResourceLookup,
): ConfigResource {
  const byId = resources.get(ref as ConfigResource['id'])
  if (byId != null) return assertUsableResource(agent, field, expectedKind, ref, projectId, byId)

  const named = resources.list().filter((resource) => resource.name === ref)
  const matchingKind = named.filter((resource) => resource.kind === expectedKind)
  const projectMatches = projectId == null
    ? []
    : matchingKind.filter((resource) => resource.projectId === projectId)
  if (projectMatches.length === 1 && projectMatches[0] != null) return projectMatches[0]
  if (projectMatches.length > 1) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" is ambiguous in project scope`, 'resource_ambiguous')
  }

  const factoryMatches = matchingKind.filter((resource) => resource.projectId == null)
  if (factoryMatches.length === 1 && factoryMatches[0] != null) return factoryMatches[0]
  if (factoryMatches.length > 1) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" is ambiguous in factory scope`, 'resource_ambiguous')
  }

  if (matchingKind.length > 0) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" references a ${expectedKind} resource outside the run project`, 'resource_cross_project')
  }

  const wrongKind = named[0]
  if (wrongKind != null) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" references ${wrongKind.kind}, expected ${expectedKind}`, 'resource_wrong_kind')
  }

  throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} not found: ${ref}`, 'resource_not_found')
}

function assertUsableResource(
  agent: Pick<Agent, 'name'>,
  field: 'modelRef' | 'harnessRef' | 'sandboxRef' | 'workflowProfileRef',
  expectedKind: ConfigResourceKind,
  ref: string,
  projectId: ProjectId | null,
  resource: ConfigResource,
): ConfigResource {
  if (resource.kind !== expectedKind) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" references ${resource.kind}, expected ${expectedKind}`, 'resource_wrong_kind')
  }
  if (resource.projectId != null && resource.projectId !== projectId) {
    throw new AgentRuntimeResolutionError(`Agent ${agent.name} ${field} "${ref}" references a ${expectedKind} resource outside the run project`, 'resource_cross_project')
  }
  return resource
}

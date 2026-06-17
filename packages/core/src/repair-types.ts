export type RepairArea =
  | 'factory_setup'
  | 'project_readiness'
  | 'repository_readiness'
  | 'agent_readiness'
  | 'provider_auth'
  | 'workflow_validity'
  | 'spec_start'
  | 'attempt_recovery'
  | 'migration'

export type RepairSeverity = 'blocker' | 'attention'

export type RepairReadinessState =
  | 'ready'
  | 'configured'
  | 'unknown'
  | 'not_checked'
  | 'missing'
  | 'not_applicable'

export interface RepairRecordRef {
  type: string
  id: string | null
  name: string | null
}

export interface RepairFieldRef {
  path: string
  label: string
  value: string | null
}

export interface RepairTarget {
  projectId?: string
  projectName?: string
  repositoryId?: string
  repositoryName?: string
  specId?: string
  specName?: string
  taskId?: string
  taskName?: string
  attemptId?: string
  agentId?: string
  agentName?: string
  providerId?: string
}

export interface PrerequisiteIssue {
  id: string
  area: RepairArea
  severity: RepairSeverity
  title: string
  reason: string
  suggestedAction: string
  record: RepairRecordRef
  field: RepairFieldRef
  blocks: string
  status: RepairReadinessState
  issueCode: string | null
  target: RepairTarget | null
  href: string | null
  linkLabel: string | null
}

export type RepairItem = PrerequisiteIssue

export interface RepairGroup {
  area: RepairArea
  label: string
  blocks: string
  items: RepairItem[]
}

export interface RepairSummary {
  total: number
  blockers: number
  attention: number
  byArea: Record<RepairArea, number>
}

export interface ProjectDispatchEligibility {
  projectId: string
  projectName: string
  eligible: boolean
  blockerIds: string[]
}

export interface RepairReport {
  generatedAt: string
  items: RepairItem[]
  groups: RepairGroup[]
  summary: RepairSummary
  projectDispatch: ProjectDispatchEligibility[]
}

export interface RepairCheckStatus {
  state: RepairReadinessState
  label?: string
  detail?: string
  checkedAt?: string
}

export interface RepositoryHostChecks {
  localGit?: RepairCheckStatus
}

export interface RepairHostChecks {
  git?: RepairCheckStatus
  github?: RepairCheckStatus
  providerAuth?: Record<string, RepairCheckStatus>
  factoryDataDir?: RepairCheckStatus
  localApp?: RepairCheckStatus
  repositories?: Record<string, RepositoryHostChecks>
  workflows?: Record<string, RepairCheckStatus>
}

export const REPAIR_AREA_ORDER: RepairArea[] = [
  'factory_setup',
  'project_readiness',
  'repository_readiness',
  'agent_readiness',
  'provider_auth',
  'workflow_validity',
  'spec_start',
  'attempt_recovery',
  'migration',
]

export const REPAIR_AREA_LABEL: Record<RepairArea, string> = {
  factory_setup: 'Factory setup',
  project_readiness: 'Project readiness',
  repository_readiness: 'Repository readiness',
  agent_readiness: 'Agent readiness',
  provider_auth: 'Provider auth',
  workflow_validity: 'Workflow validity',
  spec_start: 'Spec start',
  attempt_recovery: 'Attempt recovery',
  migration: 'Migration',
}

export const REPAIR_AREA_BLOCKS: Record<RepairArea, string> = {
  factory_setup: 'Blocks the factory from dispatching or notifying.',
  project_readiness: 'Blocks a project from accepting or running work.',
  repository_readiness: 'Blocks attempts that need a ready repository.',
  agent_readiness: 'Blocks dispatch when no usable agent exists.',
  provider_auth: 'Blocks agents whose provider is not authenticated.',
  workflow_validity: 'Blocks projects whose workflow does not validate.',
  spec_start: 'Blocks a spec from starting attempts until its repositories are ready.',
  attempt_recovery: 'Attempts that stopped or recorded inconsistent execution.',
  migration: 'Legacy migration that has not completed cleanly.',
}

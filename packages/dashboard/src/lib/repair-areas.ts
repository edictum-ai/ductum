/**
 * Repair area taxonomy — the operator-facing "what does this block" groups
 * (operational-model-redesign Part 6 / P8 scope). Kept in its own module so
 * the repair builder stays within the file-size gate. All copy uses operator
 * vocabulary — never Target, Resource, or Seed.
 */
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

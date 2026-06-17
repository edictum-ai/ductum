import {
  REPAIR_AREA_BLOCKS,
  type PrerequisiteIssue,
  type RepairArea,
  type RepairFieldRef,
  type RepairReadinessState,
  type RepairRecordRef,
  type RepairSeverity,
  type RepairTarget,
} from './repair-types.js'
import { safeRepairText, safeRepairValue } from './repair-redaction.js'

export function repairItem(input: {
  id: string
  area: RepairArea
  severity: RepairSeverity
  title: string
  reason: string
  suggestedAction: string
  record: RepairRecordRef
  field: Omit<RepairFieldRef, 'value'> & { value?: unknown }
  status?: RepairReadinessState
  issueCode?: string | null
  target?: RepairTarget | null
  href?: string | null
  linkLabel?: string | null
}): PrerequisiteIssue {
  return {
    id: input.id,
    area: input.area,
    severity: input.severity,
    title: safeRepairText(input.title),
    reason: safeRepairText(input.reason),
    suggestedAction: safeRepairText(input.suggestedAction),
    record: input.record,
    field: {
      path: input.field.path,
      label: input.field.label,
      value: safeRepairValue(input.field.path, input.field.value),
    },
    blocks: REPAIR_AREA_BLOCKS[input.area],
    status: input.status ?? 'missing',
    issueCode: input.issueCode ?? null,
    target: input.target ?? null,
    href: input.href ?? null,
    linkLabel: input.linkLabel ?? null,
  }
}

export function recordRef(type: string, id?: string | null, name?: string | null): RepairRecordRef {
  return { type, id: id ?? null, name: name ?? null }
}

export function projectPath(projectName: string, suffix: string): string {
  return `projects.${segment(projectName)}.${suffix}`
}

export function agentPath(agentName: string, suffix: string): string {
  return `agents.${segment(agentName)}.${suffix}`
}

export function repositoryPath(projectName: string, repositoryName: string, suffix: string): string {
  return `projects.${segment(projectName)}.repositories.${segment(repositoryName)}.${suffix}`
}

export function segment(value: string): string {
  return value.replaceAll('.', '\\.')
}

import type { RepairArea } from '@/lib/repair-areas'

export type { RepairArea } from '@/lib/repair-areas'
export { REPAIR_AREA_BLOCKS, REPAIR_AREA_LABEL, REPAIR_AREA_ORDER } from '@/lib/repair-areas'

export type RepairSeverity = 'blocker' | 'attention'

export interface RepairTarget {
  project?: string
  spec?: string
  task?: string
  attempt?: string
}

export interface RepairItem {
  id: string
  area: RepairArea
  severity: RepairSeverity
  /** Human label — never a raw issue code. */
  title: string
  /** Plain-language explanation of what is wrong. */
  reason: string
  /** What the operator should do next. */
  suggestedAction: string
  /** Affected record locator, when a concrete record exists. */
  record: string | null
  /** Exact field or setting at fault, when known. */
  field: string | null
  /** Raw issue code, kept for secondary/debug presentation only. */
  issueCode: string | null
  target: RepairTarget | null
  /** Link to the relevant Project/Spec/Task/Attempt/Settings page. */
  href: string | null
  /** Accessible label for the link, e.g. "Open attempt". */
  linkLabel: string | null
}

export interface RepairGroup {
  area: RepairArea
  label: string
  blocks: string
  items: RepairItem[]
}

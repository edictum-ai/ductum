export type OperatorActionId =
  | 'approve'
  | 'approveRebase'
  | 'reject'
  | 'retry'
  | 'cancel'
  | 'budgetExtend'
  | 'budgetDeny'
  | 'turnsExtend'
  | 'turnsDeny'
export type DashboardOperatorActionId = 'approve' | 'approveRebase' | 'reject' | 'retry' | 'cancel'
export type ReasonPolicy = 'required' | 'optional' | 'none'

export interface OperatorActionManifestEntry {
  id: OperatorActionId
  label: string
  apiEndpoint: string
  cliCommand: string | null
  dashboardControl: string | null
  reasonPolicy: {
    api: ReasonPolicy
    cli: ReasonPolicy | null
    dashboard: ReasonPolicy | null
  }
  parityNote?: string
}

export const OPERATOR_ACTION_MANIFEST: readonly OperatorActionManifestEntry[] = [
  {
    id: 'approve',
    label: 'Approve & merge',
    apiEndpoint: 'POST /api/runs/:id/approve',
    cliCommand: 'ductum approve <attemptId> --reason <text>',
    dashboardControl: 'RunControls.approve',
    reasonPolicy: { api: 'optional', cli: 'optional', dashboard: 'required' },
  },
  {
    id: 'approveRebase',
    label: 'Approve with rebase',
    apiEndpoint: 'POST /api/runs/:id/approve-rebase',
    cliCommand: 'ductum approve <attemptId> --rebase',
    dashboardControl: 'RunControls.approveRebase',
    reasonPolicy: { api: 'none', cli: 'none', dashboard: 'none' },
  },
  {
    id: 'reject',
    label: 'Reject',
    apiEndpoint: 'POST /api/runs/:id/reject',
    cliCommand: 'ductum deny <attemptId> --reason <text>',
    dashboardControl: 'RunControls.reject',
    reasonPolicy: { api: 'required', cli: 'required', dashboard: 'required' },
  },
  {
    id: 'retry',
    label: 'Retry',
    apiEndpoint: 'POST /api/runs/:id/retry',
    cliCommand: 'ductum retry <attemptId> --reason <text>',
    dashboardControl: 'RunControls.retry',
    reasonPolicy: { api: 'optional', cli: 'optional', dashboard: 'required' },
  },
  {
    id: 'cancel',
    label: 'Cancel attempt',
    apiEndpoint: 'POST /api/runs/:id/cancel',
    cliCommand: 'ductum cancel <attemptId> --reason <text>',
    dashboardControl: 'RunControls.cancel',
    reasonPolicy: { api: 'required', cli: 'required', dashboard: 'required' },
  },
  {
    id: 'budgetExtend',
    label: 'Extend budget',
    apiEndpoint: 'POST /api/runs/:id/budget-extend',
    cliCommand: 'ductum attempt budget-extend <attemptId> --by <usd> --reason <text>',
    dashboardControl: 'RunRecoveryControls.budgetExtend',
    reasonPolicy: { api: 'optional', cli: 'optional', dashboard: 'optional' },
  },
  {
    id: 'budgetDeny',
    label: 'Deny budget extension',
    apiEndpoint: 'POST /api/runs/:id/budget-deny',
    cliCommand: 'ductum attempt budget-deny <attemptId> --reason <text>',
    dashboardControl: 'RunRecoveryControls.budgetDeny',
    reasonPolicy: { api: 'required', cli: 'required', dashboard: 'required' },
  },
  {
    id: 'turnsExtend',
    label: 'Extend turns',
    apiEndpoint: 'POST /api/runs/:id/turns-extend',
    cliCommand: 'ductum attempt turns-extend <attemptId> --by <count> --reason <text>',
    dashboardControl: 'RunRecoveryControls.turnsExtend',
    reasonPolicy: { api: 'optional', cli: 'optional', dashboard: 'optional' },
  },
  {
    id: 'turnsDeny',
    label: 'Deny turn extension',
    apiEndpoint: 'POST /api/runs/:id/turns-deny',
    cliCommand: 'ductum attempt turns-deny <attemptId> --reason <text>',
    dashboardControl: 'RunRecoveryControls.turnsDeny',
    reasonPolicy: { api: 'required', cli: 'required', dashboard: 'required' },
  },
] as const

const DASHBOARD_ACTION_IDS = new Set<OperatorActionId>(['approve', 'approveRebase', 'reject', 'retry', 'cancel'])

export const DASHBOARD_OPERATOR_ACTIONS = OPERATOR_ACTION_MANIFEST.filter(
  (action): action is OperatorActionManifestEntry & { id: DashboardOperatorActionId; dashboardControl: string; cliCommand: string } =>
    DASHBOARD_ACTION_IDS.has(action.id) && action.dashboardControl != null && action.cliCommand != null,
)

export function operatorAction(id: OperatorActionId): OperatorActionManifestEntry {
  const action = OPERATOR_ACTION_MANIFEST.find((item) => item.id === id)
  if (action == null) throw new Error(`Unknown operator action: ${id}`)
  return action
}

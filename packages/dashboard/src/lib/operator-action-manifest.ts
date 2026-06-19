export type OperatorActionId = 'approve' | 'reject' | 'retry' | 'cancel'

export interface OperatorActionManifestEntry {
  id: OperatorActionId
  label: string
  apiEndpoint: string
  cliCommand: string
  uiControl: string
  requiresReason: boolean
}

export const OPERATOR_ACTION_MANIFEST: readonly OperatorActionManifestEntry[] = [
  {
    id: 'approve',
    label: 'Approve & merge',
    apiEndpoint: 'POST /api/runs/:id/approve',
    cliCommand: 'ductum approve <attemptId> --reason <text>',
    uiControl: 'RunControls.approve',
    requiresReason: true,
  },
  {
    id: 'reject',
    label: 'Reject',
    apiEndpoint: 'POST /api/runs/:id/reject',
    cliCommand: 'ductum deny <attemptId> --reason <text>',
    uiControl: 'RunControls.reject',
    requiresReason: true,
  },
  {
    id: 'retry',
    label: 'Retry',
    apiEndpoint: 'POST /api/runs/:id/retry',
    cliCommand: 'ductum retry <attemptId> --reason <text>',
    uiControl: 'RunControls.retry',
    requiresReason: true,
  },
  {
    id: 'cancel',
    label: 'Cancel attempt',
    apiEndpoint: 'POST /api/runs/:id/cancel',
    cliCommand: 'ductum cancel <attemptId> --reason <text>',
    uiControl: 'RunControls.cancel',
    requiresReason: true,
  },
] as const

export function operatorAction(id: OperatorActionId): OperatorActionManifestEntry {
  const action = OPERATOR_ACTION_MANIFEST.find((item) => item.id === id)
  if (action == null) throw new Error(`Unknown operator action: ${id}`)
  return action
}

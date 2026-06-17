export interface ServePlan {
  command: 'start'
  factoryDir: string
  dbPath: string
  apiUrl: string
  host: string
  port: number
  dispatch: boolean
  tokenDetectEnabled: boolean
  apiEntry: string
  dashboardDist: string
  workflowsDir: string
  sampleSpecsDir: string
}

export function renderPlan(plan: ServePlan): string {
  return [
    `Ductum ${plan.command}`,
    '',
    'Project Summary',
    '  Project data loads after the control plane is open.',
    '  Check: ductum status',
    '',
    'Factory Activity',
    `  state: ${plan.dispatch ? 'running; ready Tasks may start Attempts after startup' : 'paused by --no-dispatch'}`,
    `  app:   ${plan.apiUrl}`,
    '',
    'Setup',
    '  state: using DB-backed Factory data',
    `  database:      ${plan.dbPath}`,
    '',
    'Next Operator Actions',
    `  1. Open ${plan.apiUrl}`,
    '  2. Review Projects and Factory Activity: ductum status',
  ].join('\n')
}

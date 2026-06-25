export interface ServePlan {
  command: 'start'
  factoryDir: string
  dbPath: string
  apiUrl: string
  host: string
  port: number
  dispatch: boolean
  publicBind: boolean
  tokenDetectEnabled: boolean
  browserHandoffEnabled: boolean
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
    `  browser handoff: ${plan.browserHandoffEnabled ? 'enabled for local auto-open' : 'disabled for this bind host'}`,
    ...publicBindGuidance(plan),
    '',
    'Setup',
    '  state: using DB-backed Factory data',
    `  database:      ${plan.dbPath}`,
    '',
    'Next Operator Actions',
    `  1. Open ${plan.apiUrl}`,
    '  2. Review Projects and Factory Activity: ductum status',
    '  3. If the browser was not auto-opened, use Settings -> Manual API access',
  ].join('\n')
}

function publicBindGuidance(plan: ServePlan): string[] {
  if (!plan.publicBind) return []
  return [
    '  warning: public bind enabled; operator-token detect and browser handoff stay local-only',
    '  deployment: put this API behind TLS plus a trusted reverse proxy or tunnel before remote access',
  ]
}

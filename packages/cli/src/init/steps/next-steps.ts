import * as p from '@clack/prompts'

import type { CliContext } from '../../runtime.js'
import { renderCliConfigCommand, type InitHandoffResult } from './browser-handoff.js'

export function renderNextSteps(
  projectDir: string,
  handoff?: Pick<InitHandoffResult, 'apiUrl' | 'dashboardUrl' | 'handoffUrl' | 'browserOpened' | 'tokenPath'>,
): string {
  const needsCliAuth = handoff != null && (handoff.browserOpened === false || handoff.handoffUrl == null)
  const dashboard = handoff?.browserOpened === false
    ? handoff.handoffUrl ?? handoff.dashboardUrl
    : handoff?.dashboardUrl
  const lines = [
    `cd ${projectDir}`,
    dashboard == null
      ? 'Open the dashboard after the API starts.'
      : `Open ${dashboard}`,
  ]
  if (needsCliAuth) {
    lines.push(
      `Token file: ${handoff.tokenPath}`,
      renderCliConfigCommand(handoff.tokenPath, handoff.apiUrl),
      'ductum status',
    )
  }
  return lines.join('\n')
}

export function showNextSteps(projectDir: string, ctx: CliContext, handoff?: Pick<InitHandoffResult, 'apiUrl' | 'dashboardUrl' | 'handoffUrl' | 'browserOpened' | 'tokenPath'>): void {
  p.outro(`Next steps:\n${renderNextSteps(projectDir, handoff)}`, {
    input: ctx.stdin,
    output: ctx.stdout,
  })
}

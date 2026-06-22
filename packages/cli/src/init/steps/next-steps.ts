import * as p from '@clack/prompts'

import type { CliContext } from '../../runtime.js'
import { renderTokenExportCommand, type InitHandoffResult } from './browser-handoff.js'

export function renderNextSteps(
  projectDir: string,
  handoff?: Pick<InitHandoffResult, 'apiUrl' | 'dashboardUrl' | 'handoffUrl' | 'browserOpened' | 'tokenPath'>,
): string {
  const dashboard = handoff?.browserOpened === false ? handoff.handoffUrl : handoff?.dashboardUrl
  const lines = [
    `cd ${projectDir}`,
    dashboard == null
      ? 'Open the dashboard after the API starts.'
      : `Open ${dashboard}`,
  ]
  if (handoff?.browserOpened === false) {
    lines.push(
      `Token file: ${handoff.tokenPath}`,
      renderTokenExportCommand(handoff.tokenPath),
      `ductum status --api-url ${handoff.apiUrl}`,
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

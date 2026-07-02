import type {
  FactoryDoctorCheck,
  RepairCheckStatus,
  RepairHostChecks,
} from '@ductum/core'

import {
  effectiveHarnessAuthCommand,
  probeCodexCommandAuth,
  probeGithubCopilotLocalAuth,
} from './provider-auth.js'

/**
 * Issue #217: provider-auth probe for the factory doctor. Extracted so the
 * `/api/factory/doctor` and `/api/factory/ops-health` routes share the same
 * auth-readiness interpretation — without it the two surfaces could
 * disagree about whether a Codex/Copilot agent is ready.
 */

export function factoryDoctorAuthProbe(input: {
  agentId: string
  providerId: string
  harnessType: string
  command?: string
}, host?: RepairHostChecks): FactoryDoctorCheck | null {
  if (input.providerId === 'openai' && (input.harnessType === 'codex-sdk' || input.harnessType === 'codex-app-server')) {
    const command = effectiveHarnessAuthCommand(input.harnessType, input.command) ?? 'codex'
    const status = host?.providerAuthByAgent?.[input.agentId]
      ?? providerCredentialSourceStatus(host?.providerAuth?.openai)
      ?? probeCodexCommandAuth(command)
    return doctorAuthCheck(status, [command], 'Codex login status is active')
  }
  if (input.providerId === 'github-copilot' && input.harnessType === 'copilot-sdk') {
    const status = host?.providerAuth?.['github-copilot'] ?? probeGithubCopilotLocalAuth()
    return doctorAuthCheck(status, ['gh auth status'], 'GitHub CLI auth status is active for Copilot')
  }
  return null
}

function providerCredentialSourceStatus(status: RepairCheckStatus | undefined): RepairCheckStatus | undefined {
  return status?.state === 'ready' && status.label === 'OpenAI credential source detected' ? status : undefined
}

function doctorAuthCheck(
  status: RepairCheckStatus | undefined,
  refs: string[],
  readyMessage: string,
): FactoryDoctorCheck | null {
  if (status == null) return null
  if (status.state === 'ready') {
    const message = status.label?.includes('hosts file') ? status.label : readyMessage
    return { kind: 'auth', status: 'ready', message, refs }
  }
  if (status.state === 'unknown' || status.state === 'not_checked') {
    return { kind: 'auth', status: 'deferred', message: status.detail ?? status.label ?? status.state, refs }
  }
  if (status.state === 'missing') {
    return { kind: 'auth', status: 'blocked', message: status.detail ?? status.label ?? 'Shared auth readiness is missing', refs }
  }
  return null
}

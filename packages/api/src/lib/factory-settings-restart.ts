import type {
  FactoryRuntimeCurrentSettings,
  FactoryRuntimeDesiredSettings,
  FactoryRuntimePatch,
  FactorySettingsAffectedRuntime,
} from '@ductum/core'

export function restartAffectedRuntimes(
  current: FactoryRuntimeCurrentSettings,
  desired: FactoryRuntimeDesiredSettings,
): FactorySettingsAffectedRuntime[] {
  const affected = new Set<FactorySettingsAffectedRuntime>()
  if (desired.apiBindHost != null && desired.apiBindHost !== current.apiBindHost) affected.add('api')
  if (desired.apiPort != null && desired.apiPort !== current.apiPort) affected.add('api')
  if (desired.publicApiUrl != null && desired.publicApiUrl !== current.publicApiUrl) {
    affected.add('api')
    affected.add('notifications')
  }
  if (desired.dashboardUrl != null && desired.dashboardUrl !== current.dashboardUrl) affected.add('dashboard')
  if (desired.dispatcherEnabled != null && desired.dispatcherEnabled !== current.dispatcherEnabled) affected.add('dispatcher')
  if (desired.dispatcherHeartbeatIntervalSeconds != null && desired.dispatcherHeartbeatIntervalSeconds !== current.dispatcherHeartbeatIntervalSeconds) affected.add('dispatcher')
  if (desired.worktreeEnabled != null && desired.worktreeEnabled !== current.worktreeEnabled) affected.add('dispatcher')
  if (desired.worktreeBasePath != null && desired.worktreeBasePath !== current.worktreeBasePath) affected.add('dispatcher')
  if (current.attemptCeilingsSource !== 'env' && !sameAttemptCeilings(current.attemptCeilings, desired.attemptCeilings)) {
    affected.add('dispatcher')
    affected.add('active_attempts')
  }
  return [...affected]
}

export function affectedRuntimesForPatch(
  current: FactoryRuntimeCurrentSettings | null,
  desired: FactoryRuntimeDesiredSettings,
  patch: FactoryRuntimePatch,
): FactorySettingsAffectedRuntime[] {
  if (current == null) return []
  const affected = restartAffectedRuntimes(current, desired)
  const patchAffected = new Set<FactorySettingsAffectedRuntime>()
  const keys = new Set(Object.keys(patch))
  if ((keys.has('apiBindHost') || keys.has('apiPort')) && affected.includes('api')) patchAffected.add('api')
  if (keys.has('publicApiUrl')) {
    if (affected.includes('api')) patchAffected.add('api')
    if (affected.includes('notifications')) patchAffected.add('notifications')
  }
  if (keys.has('dashboardUrl') && affected.includes('dashboard')) patchAffected.add('dashboard')
  if ((keys.has('dispatcherEnabled') || keys.has('dispatcherHeartbeatIntervalSeconds') || keys.has('worktreeEnabled') || keys.has('worktreeBasePath') || keys.has('attemptCeilings')) && affected.includes('dispatcher')) patchAffected.add('dispatcher')
  if (keys.has('attemptCeilings') && affected.includes('active_attempts')) patchAffected.add('active_attempts')
  return [...patchAffected]
}

function sameAttemptCeilings(
  current: FactoryRuntimeCurrentSettings['attemptCeilings'],
  desired: FactoryRuntimeDesiredSettings['attemptCeilings'],
): boolean {
  return current.enabled === desired.enabled &&
    current.maxInputTokensPerTurn === desired.maxInputTokensPerTurn &&
    current.maxCumulativeCostUsd === desired.maxCumulativeCostUsd &&
    current.maxTurns === desired.maxTurns
}

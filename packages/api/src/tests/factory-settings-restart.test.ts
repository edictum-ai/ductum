import type { FactoryRuntimeCurrentSettings, FactoryRuntimeDesiredSettings } from '@ductum/core'
import { describe, expect, it } from 'vitest'

import { restartAffectedRuntimes } from '../lib/factory-settings-restart.js'

describe('restartAffectedRuntimes', () => {
  it('does not report restart drift for env-overridden attempt ceilings', () => {
    const affected = restartAffectedRuntimes(
      currentSettings({ attemptCeilingsSource: 'env', maxCumulativeCostUsd: 20 }),
      desiredSettings({ maxCumulativeCostUsd: 100 }),
    )

    expect(affected).not.toContain('dispatcher')
    expect(affected).not.toContain('active_attempts')
  })

  it('reports restart drift for DB-backed attempt ceiling changes', () => {
    const affected = restartAffectedRuntimes(
      currentSettings({ attemptCeilingsSource: 'factory', maxCumulativeCostUsd: 20 }),
      desiredSettings({ maxCumulativeCostUsd: 100 }),
    )

    expect(affected).toEqual(expect.arrayContaining(['dispatcher', 'active_attempts']))
  })
})

function currentSettings(input: {
  attemptCeilingsSource: FactoryRuntimeCurrentSettings['attemptCeilingsSource']
  maxCumulativeCostUsd: number
}): FactoryRuntimeCurrentSettings {
  return {
    apiBindHost: null,
    apiPort: null,
    publicApiUrl: null,
    dashboardUrl: null,
    dbPath: null,
    factoryDataDir: null,
    dispatcherRunning: true,
    dispatcherEnabled: true,
    dispatcherHeartbeatIntervalSeconds: 10,
    heartbeatTimeoutSeconds: 120,
    worktreeEnabled: true,
    worktreeBasePath: null,
    mergeConfig: mergeConfig(),
    costBudget: {},
    attemptCeilings: attemptCeilings(input.maxCumulativeCostUsd),
    attemptCeilingsSource: input.attemptCeilingsSource,
    workflowProfiles: { entries: [] },
  }
}

function desiredSettings(input: { maxCumulativeCostUsd: number }): FactoryRuntimeDesiredSettings {
  return {
    apiBindHost: null,
    apiPort: null,
    publicApiUrl: null,
    dashboardUrl: null,
    dispatcherEnabled: true,
    dispatcherHeartbeatIntervalSeconds: 10,
    heartbeatTimeoutSeconds: 120,
    worktreeEnabled: true,
    worktreeBasePath: null,
    mergeConfig: mergeConfig(),
    costBudget: {},
    attemptCeilings: attemptCeilings(input.maxCumulativeCostUsd),
    workflowProfiles: { entries: [] },
  }
}

function mergeConfig(): FactoryRuntimeCurrentSettings['mergeConfig'] {
  return {
    push: false,
    base: 'main',
    strategy: 'merge',
    pushTags: false,
    approvalCiGate: { enabled: true, requiredChecks: [], failClosedOnMissing: true },
  }
}

function attemptCeilings(maxCumulativeCostUsd: number): FactoryRuntimeCurrentSettings['attemptCeilings'] {
  return {
    recordType: 'AttemptCeilings',
    id: 'factory-attempt-ceilings',
    name: 'Factory attempt ceilings',
    scope: 'factory',
    projectId: null,
    enabled: true,
    maxInputTokensPerTurn: 2_000_000,
    maxCumulativeCostUsd,
    maxTurns: 200,
    configSource: 'configured',
    source: 'saved',
  }
}

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyWorkflowProfileRuntimeData,
  buildFactorySettingsCatalogs,
  redactPublicText,
  type FactorySettingsCatalogs,
  type FactorySettingsWorkflow,
  type RunWorkflowProfileSnapshot,
} from '@ductum/core'

import type { ApiContext } from './deps.js'
import { normalizeCostBudget } from './factory-settings-api.js'

export function buildApiFactorySettings(context: ApiContext): FactorySettingsCatalogs {
  const factory = context.repos.factory.get()
  const savedBudget = normalizeCostBudget(factory?.config.costBudget)
  const catalogs = buildFactorySettingsCatalogs({
    factory,
    configResources: context.repos.configResources.list(),
    agents: context.repos.agents.list(),
    costBudget: hasBudgetKeys(savedBudget) ? savedBudget : normalizeCostBudget(context.costBudget),
  })
  return {
    ...catalogs,
    workflows: catalogs.workflows.map((workflow) => ({
      ...workflow,
      validation: validateFactorySettingsWorkflow(context, workflow),
    })),
  }
}

function hasBudgetKeys(value: ReturnType<typeof normalizeCostBudget>): boolean {
  return ['perRunWarnUsd', 'perRunHardUsd', 'perSpecHardUsd'].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  )
}

export function validateFactorySettingsWorkflow(
  context: ApiContext,
  workflow: FactorySettingsWorkflow,
): FactorySettingsWorkflow['validation'] {
  if (context.validateWorkflowProfile == null) {
    return { valid: false, error: 'Workflow validation is unavailable' }
  }
  try {
    const profile = snapshotFromWorkflow(workflow)
    const data = context.validateWorkflowProfile(profile)
    const materialized = applyWorkflowProfileRuntimeData(profile, data)
    return {
      valid: true,
      setupCommands: (materialized.setupCommands ?? []).map(redactPublicText),
      verifyCommands: (materialized.verifyCommands ?? []).map(redactPublicText),
    }
  } catch (error) {
    return { valid: false, error: redactPublicText(error instanceof Error ? error.message : String(error)) }
  }
}

function snapshotFromWorkflow(workflow: FactorySettingsWorkflow): RunWorkflowProfileSnapshot {
  return {
    id: workflow.id as RunWorkflowProfileSnapshot['id'],
    name: workflow.workflowId,
    projectId: workflow.projectId as RunWorkflowProfileSnapshot['projectId'],
    path: resolveWorkflowPath(workflow.path),
    ...(workflow.description == null ? {} : { description: workflow.description }),
  }
}

function resolveWorkflowPath(path: string): string {
  if (existsSync(path)) return path
  for (const candidateRoot of workflowAssetRoots()) {
    const candidate = resolve(candidateRoot, path)
    if (existsSync(candidate)) return candidate
  }
  return path
}

function workflowAssetRoots(): string[] {
  const here = import.meta.url
  return [
    process.cwd(),
    fileURLToPath(new URL('../../../../', here)),
    fileURLToPath(new URL('../../', here)),
  ]
}

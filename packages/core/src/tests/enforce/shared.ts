import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Session } from '@edictum/core'

import { DuctumEventEmitter } from '../../events.js'
import { SqliteStorageBackend } from '../../edictum-storage.js'
import { EnforcementManager } from '../../enforce.js'
import {
  collectWorkflowReadPathCandidates,
  extractWorkflowReadPath,
} from '../../shell-read-detection.js'
import { RunStateMachine } from '../../state-machine.js'
import { normalizeWorkflowToolArgs } from '../../workflow-tool-args.js'

import type { WorkflowStage } from '../../types.js'
import { createIds, createRepoContext } from '../helpers.js'
import { seedBase } from '../helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []
export const tempDirs: string[] = []
const workflowPath = fileURLToPath(
  new URL('../../../../../workflows/coding-guard.yaml', import.meta.url),
)
const workflowTemplatePath = fileURLToPath(
  new URL('../../../../../workflows/coding-guard-template.yaml', import.meta.url),
)

afterEach(() => {
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

export function createFixture(
  stage: WorkflowStage = 'understand',
  options: { protectedShellPaths?: readonly string[] } = {},
) {
  const context = createRepoContext()
  cleanup.push(context)
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: `task-${ids.taskId}`,
    prompt: 'implement P2',
    repos: ['packages/core'],
    assignedAgentId: builder.id,
    status: 'active',
    verification: ['pnpm test'],
  })
  const run = context.runRepo.create({
    id: ids.runId,
    taskId: task.id,
    agentId: builder.id,
    parentRunId: null,
    stage,
    terminalState: null,
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: 'session-1',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-04T10:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
  const eventEmitter = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(
    context.runRepo,
    context.runStageHistoryRepo,
    eventEmitter,
  )
  const manager = new EnforcementManager({
    fallbackWorkflowPath: workflowPath,
    templateWorkflowPath: workflowTemplatePath,
    storageBackend: new SqliteStorageBackend(context.db),
    projectRepo: context.projectRepo,
    repositoryRepo: context.repositoryRepo,
    runRepo: context.runRepo,
    sessionRunMappingRepo: context.sessionRunMappingRepo,
    specRepo: context.specRepo,
    taskRepo: context.taskRepo,
    evidenceRepo: context.evidenceRepo,
    gateEvaluationRepo: context.gateEvaluationRepo,
    stateMachine,
    eventEmitter,
    protectedShellPaths: options.protectedShellPaths,
  })

  return { context, run, manager, stateMachine }
}

export function createWorkflowSession(
  fixture: ReturnType<typeof createFixture>,
): Session {
  return new Session(fixture.run.id, new SqliteStorageBackend(fixture.context.db))
}

export { collectWorkflowReadPathCandidates, describe, expect, extractWorkflowReadPath, it, join, mkdirSync, mkdtempSync, normalizeWorkflowToolArgs, relative, resolve, symlinkSync, tmpdir }

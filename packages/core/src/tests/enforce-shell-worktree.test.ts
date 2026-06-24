import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DuctumEventEmitter } from '../events.js'
import { SqliteStorageBackend } from '../edictum-storage.js'
import { EnforcementManager } from '../enforce.js'
import { RunStateMachine } from '../state-machine.js'
import { createSqliteTransactionRunner } from '../sqlite-transaction.js'
import type { WorkflowStage } from '../types.js'
import { createIds, createRepoContext, seedBase } from './helpers.js'

const cleanup: ReturnType<typeof createRepoContext>[] = []
const tempDirs: string[] = []
const workflowPath = fileURLToPath(
  new URL('../../../../workflows/coding-guard.yaml', import.meta.url),
)
const workflowTemplatePath = fileURLToPath(
  new URL('../../../../workflows/coding-guard-template.yaml', import.meta.url),
)

afterEach(() => {
  for (const context of cleanup.splice(0)) context.db.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function createFixture(stage: WorkflowStage = 'implement') {
  const context = createRepoContext()
  cleanup.push(context)
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: `task-${ids.taskId}`,
    prompt: 'verify worktree shell scope',
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
    sessionId: 'session-worktree-1',
    branch: null,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    worktreePaths: null,
    runtimeModel: null,
    runtimeHarness: null,
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-04-30T02:00:00Z',
    heartbeatTimeoutSeconds: 120,
  })
  const eventEmitter = new DuctumEventEmitter()
  const stateMachine = new RunStateMachine(
    context.runRepo,
    context.runStageHistoryRepo,
    eventEmitter,
    { runCheckpointRepo: context.runCheckpointRepo },
  )
  const manager = new EnforcementManager({
    fallbackWorkflowPath: workflowPath,
    templateWorkflowPath: workflowTemplatePath,
    storageBackend: new SqliteStorageBackend(context.db),
    projectRepo: context.projectRepo,
    runRepo: context.runRepo,
    sessionRunMappingRepo: context.sessionRunMappingRepo,
    specRepo: context.specRepo,
    taskRepo: context.taskRepo,
    evidenceRepo: context.evidenceRepo,
    gateEvaluationRepo: context.gateEvaluationRepo,
    stateMachine,
    eventEmitter,
    gateCommitTransaction: createSqliteTransactionRunner(context.db),
  })
  const baseDir = mkdtempSync(join(tmpdir(), 'ductum-shell-worktree-'))
  tempDirs.push(baseDir)
  context.sessionRunMappingRepo.create({
    sessionId: 'session-worktree-1',
    runId: run.id,
    harness: 'codex-sdk',
    workingDir: baseDir,
  })
  return { baseDir, context, manager, run }
}

describe('EnforcementManager worktree shell scope', () => {
  it('blocks absolute-path host reads and navigation with operator-visible reasons', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const catResult = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'cat /etc/passwd',
    })
    const cdResult = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'printf ok && cd /tmp',
    })
    const gitResult = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'git -C /usr/local status',
    })

    expect(catResult).toMatchObject({ allowed: false, reason: expect.stringContaining('/etc/passwd') })
    expect(cdResult).toMatchObject({ allowed: false, reason: expect.stringContaining('/tmp') })
    expect(gitResult).toMatchObject({ allowed: false, reason: expect.stringContaining('/usr/local') })
    expect(catResult.reason).toContain('outside the run worktree')
    expect(fixture.context.gateEvaluationRepo.list(fixture.run.id).map((row) => row.result)).toEqual([
      'blocked',
      'blocked',
      'blocked',
    ])
    expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
      kind: 'tool.command_blocked',
      toolName: 'Bash',
      baseDir: fixture.baseDir,
      reason: expect.stringContaining('outside the run worktree'),
    })
  })

  it('allows in-worktree relative and absolute Bash reads', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: `cat README.md && head ${fixture.baseDir}/README.md`,
    })

    expect(result).toEqual({ allowed: true, reason: undefined })
  })
})

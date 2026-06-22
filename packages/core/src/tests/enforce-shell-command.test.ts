import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Session } from '@edictum/core'

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
  for (const context of cleanup.splice(0)) {
    context.db.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixture(stage: WorkflowStage = 'understand') {
  const context = createRepoContext()
  cleanup.push(context)
  const ids = createIds()
  const { builder, spec } = seedBase(context)
  const task = context.taskRepo.create({
    id: ids.taskId,
    specId: spec.id,
    name: `task-${ids.taskId}`,
    prompt: 'verify shell command stage mutation',
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
    sessionId: 'session-shell-1',
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
  const baseDir = mkdtempSync(join(tmpdir(), 'ductum-shell-run-'))
  tempDirs.push(baseDir)
  context.sessionRunMappingRepo.create({
    sessionId: 'session-shell-1',
    runId: run.id,
    harness: 'codex-sdk',
    workingDir: baseDir,
  })
  return { baseDir, context, manager, run }
}

function sessionFor(fixture: ReturnType<typeof createFixture>): Session {
  return new Session(fixture.run.id, new SqliteStorageBackend(fixture.context.db))
}

describe('EnforcementManager shell command scope', () => {
  it('blocks Bash output redirection before a write-enabled stage', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: "cat >packages/core/src/generated.ts <<'EOF'\nexport {}\nEOF",
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('stage "understand"')
    expect(fixture.context.gateEvaluationRepo.list(fixture.run.id)[0]).toMatchObject({
      result: 'blocked',
      reason: expect.stringContaining('may mutate files'),
    })
    expect(fixture.context.evidenceRepo.list(fixture.run.id)[0]?.payload).toMatchObject({
      kind: 'tool.command_blocked',
      toolName: 'Bash',
      baseDir: fixture.baseDir,
      reason: expect.stringContaining('may mutate files'),
    })
  })

  it('blocks interpreter write APIs before a write-enabled stage', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: `python3 - <<'PY'
from pathlib import Path
Path("packages/core/src/generated.ts").write_text("export {}")
PY`,
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('may mutate files')
  })

  it('blocks shell-wrapped interpreter writes before a write-enabled stage', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: `/bin/zsh -lc "python - <<'PY'
from pathlib import Path
Path('packages/api/vitest.config.ts').write_text('changed')
PY"`,
    })

    expect(result).toMatchObject({ allowed: false })
    expect(result.reason).toContain('may mutate files')
  })

  it('blocks nested interactive shells and interpreters before a write-enabled stage', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    await expect(fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: '/bin/zsh -lc python3',
    })).resolves.toMatchObject({ allowed: false })
    await expect(fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: '/bin/sh -c /bin/sh',
    })).resolves.toMatchObject({ allowed: false })
  })

  it('allows read-only Bash commands during understand', async () => {
    const fixture = createFixture('understand')
    await fixture.manager.initialize()

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: 'rg -n "Ductum" README.md && sed -n "1,20p" README.md',
    })

    expect(result).toMatchObject({ allowed: true })
  })

  it('allows Bash file mutation after the workflow reaches implement', async () => {
    const fixture = createFixture('implement')
    await fixture.manager.initialize()
    const runtime = fixture.manager.getRuntime(fixture.run.id)
    await runtime.setStage(sessionFor(fixture), 'implement')

    const result = await fixture.manager.authorizeTool(fixture.run.id, 'Bash', {
      command: "cat >packages/core/src/generated.ts <<'EOF'\nexport {}\nEOF",
    })

    expect(result).toMatchObject({ allowed: true })
  })
})

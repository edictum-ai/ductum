import type { OperatorAttempt } from './operator-contract-types.js'
import type { OperatorAttemptSnapshot } from './attempt-types.js'
import type { Run } from './types.js'

export function operatorAttemptSnapshotFromRun(run: Run): OperatorAttemptSnapshot {
  if (run.attemptSnapshot != null) {
    return {
      completeness: 'full',
      legacy: false,
      capturedAt: run.attemptSnapshot.capturedAt,
      runtime: run.attemptSnapshot,
      missingFields: [],
    }
  }

  const runtime: OperatorAttemptSnapshot['runtime'] = {}
  const missingFields = [
    'spec',
    'task',
    'project',
    'repository',
    'agent',
    'provider',
    'model.providerModelId',
    'harness.adapterKey',
  ]

  if (run.runtimeModel != null) {
    runtime.model = { modelId: run.runtimeModel }
  }
  if (run.runtimeHarness != null) {
    runtime.harness = { harnessId: run.runtimeHarness, adapterKey: run.runtimeHarness }
    removeMissing(missingFields, 'harness.adapterKey')
  }
  if (run.runtimeWorkflowProfile != null) {
    runtime.workflow = run.runtimeWorkflowProfile
    removeMissing(missingFields, 'workflow')
  }
  if (run.runtimeSandboxProfile != null) {
    runtime.sandboxProfile = run.runtimeSandboxProfile
    removeMissing(missingFields, 'sandboxProfile')
  }
  if (run.branch != null || run.worktreePaths != null) {
    runtime.execution = {
      branch: run.branch,
      worktreePaths: run.worktreePaths ?? undefined,
    }
    removeMissing(missingFields, 'execution')
  }

  return {
    completeness: 'partial-legacy',
    legacy: true,
    runtime,
    missingFields,
  }
}

export function operatorAttemptFromRun(run: Run): OperatorAttempt {
  return {
    recordType: 'Attempt',
    id: run.id,
    name: run.id,
    taskId: run.taskId,
    agentId: run.agentId,
    stage: run.stage,
    status: attemptStatus(run),
    parentAttemptId: run.parentRunId,
    branch: run.branch,
    commitSha: run.commitSha,
    prUrl: run.prUrl,
    snapshot: operatorAttemptSnapshotFromRun(run),
  }
}

function attemptStatus(run: Run): OperatorAttempt['status'] {
  if (run.terminalState === 'failed') return 'failed'
  if (run.terminalState === 'stalled') return 'blocked'
  if (run.terminalState === 'cancelled') return 'done'
  if (run.pendingApproval) return 'needs_attention'
  if (run.stage === 'done') return 'done'
  return 'running'
}

function removeMissing(fields: string[], field: string): void {
  const index = fields.indexOf(field)
  if (index >= 0) fields.splice(index, 1)
}

import { describe, expect, it } from 'vitest'

import {
  PublicContractError,
  findSpecIntakeAttemptIssues,
  formatPublicContractIssue,
  operatorAttemptFromRun,
  operatorProjectFromProject,
  publicContractError,
  publicContractIssue,
  type OperatorPublicRecord,
  type OperatorRecordType,
} from '../lib/operator-contract.js'

describe('public operator contract facade', () => {
  it('represents the P1 operator record nouns through the API re-export', () => {
    const recordTypes: OperatorRecordType[] = [
      'Project',
      'Repository',
      'Component',
      'Spec',
      'Task',
      'Attempt',
      'Agent',
      'Provider',
      'Model',
      'Harness',
      'Workflow',
      'Factory Activity',
      'Repair',
    ]
    expect(recordTypes).toHaveLength(13)

    const records: OperatorPublicRecord[] = [
      { recordType: 'Provider', id: 'provider-openai', name: 'OpenAI', kind: 'openai', configured: true },
      { recordType: 'Repair', id: 'repair-1', name: 'Fix failed verify', taskId: 'task-1', status: 'needs_attention', reason: 'verify failed' },
    ]
    expect(records.map((record) => record.recordType)).toEqual(['Provider', 'Repair'])
  })

  it('maps internal Run to public Attempt and Project to public Project', () => {
    const attempt = operatorAttemptFromRun({
      id: 'run-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      parentRunId: null,
      stage: 'implement',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: true,
      sessionId: null,
      branch: 'feat/p1',
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
      lastHeartbeat: null,
      heartbeatTimeoutSeconds: 30,
      verifyRetries: 0,
      completionSummary: null,
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    } as never)
    expect(attempt.recordType).toBe('Attempt')
    expect(attempt.status).toBe('needs_attention')

    const project = operatorProjectFromProject({
      id: 'project-1',
      factoryId: 'factory-1',
      name: 'Ductum',
      repos: ['ductum'],
      config: { mergeMode: 'auto', workflowPath: 'workflows/coding-guard.yaml' },
      createdAt: '2026-05-25T00:00:00.000Z',
      updatedAt: '2026-05-25T00:00:00.000Z',
    } as never)
    expect(project).toMatchObject({ recordType: 'Project', name: 'Ductum', repositoryCount: 1 })
  })

  it('public errors preserve field path, label, invalid value, dependency, and action', () => {
    const issue = publicContractIssue({
      recordType: 'Task',
      recordName: 'write-contract',
      fieldPath: 'repositories[0].tasks[0].dependsOn[0]',
      humanLabel: 'Task dependency',
      invalidValue: 'missing-task',
      missingDependency: { recordType: 'Task', idOrName: 'missing-task' },
      suggestedAction: 'Add a Task named "missing-task" or remove the dependency.',
    })
    const error = publicContractError('bad input', [issue])
    expect(error).toBeInstanceOf(PublicContractError)
    expect(error.issues[0]).toEqual(issue)
    const rendered = formatPublicContractIssue(issue)
    expect(rendered).toContain('repositories[0].tasks[0].dependsOn[0]')
    expect(rendered).toContain('Missing Task "missing-task"')
  })

  it('detects generated Attempts in SpecIntake input with exact paths', () => {
    const issues = findSpecIntakeAttemptIssues({
      schemaVersion: 'ductum.spec-intake.v1',
      project: { name: 'Qratum' },
      spec: { name: 'bad-output' },
      repositories: [{ name: 'qratum', attempts: [{ id: 'run-1' }] }],
    })
    expect(issues[0]).toMatchObject({
      recordType: 'SpecIntake',
      fieldPath: 'repositories[0].attempts',
      humanLabel: 'Attempts',
    })
  })

  it('handles cyclic unknown input while detecting Attempts', () => {
    const input: Record<string, unknown> = {
      schemaVersion: 'ductum.spec-intake.v1',
      spec: { name: 'cyclic-output' },
      repositories: [{ name: 'qratum', attempts: [{ id: 'run-1' }] }],
    }
    input.self = input

    const issues = findSpecIntakeAttemptIssues(input)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.fieldPath).toBe('repositories[0].attempts')
  })
})

import { describe, expect, it } from 'vitest'

import { resolvePriorAttemptFailure } from '../dispatcher-prior-attempt-failure.js'
import { buildDispatcherSystemPrompt } from '../dispatcher-support.js'
import { buildFixPrompt, buildReviewPrompt } from '../post-completion.js'
import { createId, type Run, type Task } from '../types.js'

describe('agent prompt guardrails', () => {
  it('tells implementation agents to complete instead of pushing', () => {
    const prompt = buildDispatcherSystemPrompt(task())

    expect(prompt).toContain('Do not push branches or try to merge')
    expect(prompt).toContain('finish with `ductum_complete`')
  })

  it('points implementation agents at the run working directory when one exists', () => {
    const prompt = buildDispatcherSystemPrompt(task({ repos: ['/Users/acartagena/project/ductum'] }), {
      workingDir: '/Users/acartagena/.ductum/factories/demo/.ductum/worktrees/ductum/run/ductum',
    })

    expect(prompt).toContain('Use this run working directory for all file reads and writes')
    expect(prompt).toContain('/Users/acartagena/.ductum/factories/demo/.ductum/worktrees/ductum/run/ductum')
    expect(prompt).toContain('Do not use original repository source paths as workspaces')
    expect(prompt).not.toContain('## Repo Scope\n/Users/acartagena/project/ductum')
  })

  it('tells review and fix agents not to push or merge', () => {
    const review = buildReviewPrompt(task(), 'diff --git a/file b/file', 'tests passed')
    const fix = buildFixPrompt(task(), 'FAIL: missing assertion', 1)

    expect(review).toContain('Do not edit, push, approve, or merge')
    expect(fix).toContain('Do not push branches or merge')
  })

  it('warns retries about prompt_overflow with concrete read-budget guidance', () => {
    // #282 regression: a retry after prompt_overflow must include explicit
    // guidance so the agent does not replay the same unbounded reads.
    const prompt = buildDispatcherSystemPrompt(task(), {
      priorAttemptFailure: {
        failReason: 'prompt_overflow',
        tokensIn: 9_760_000,
        maxInputTokensInTurn: 205_000,
        turns: 37,
      },
    })

    expect(prompt).toContain('## Previous Attempt Failure - prompt overflow')
    expect(prompt).toContain('died from `prompt_overflow`')
    expect(prompt).toContain('205,000 input tokens in a single turn')
    expect(prompt).toContain('Use `Read` with `offset` and `limit`')
    expect(prompt).toContain('Use `Grep` to find symbols first')
    expect(prompt).toContain('split the task')
  })

  it('renders a non-overflow prior failure without the read-budget list', () => {
    const prompt = buildDispatcherSystemPrompt(task(), {
      priorAttemptFailure: {
        failReason: 'max_turns_reached',
        tokensIn: 1_000_000,
        maxInputTokensInTurn: 50_000,
        turns: 200,
      },
    })

    expect(prompt).toContain('## Previous Attempt Failure')
    expect(prompt).toContain('died from `max_turns_reached`')
    expect(prompt).not.toContain('prompt overflow')
    expect(prompt).not.toContain('Use `Read` with `offset`')
  })

  it('resolvePriorAttemptFailure prefers durable ceiling evidence over lossy run totals', () => {
    // #282 regression: run.tokensIn is cumulative, not per-turn. Retry prompts
    // must use the recorded ceiling evidence so the next agent sees the real
    // turn size that tripped the context guard.
    const failure = resolvePriorAttemptFailure(
      run({ failReason: 'max_turns_paused: attempt input tokens per turn 205000 exceeded cap 180000', tokensIn: 9_760_000 }),
      [{
        payload: {
          kind: 'attempt.resource_ceiling',
          ceiling: 'maxInputTokensPerTurn',
          observed: 205_000,
          cap: 180_000,
          observedTelemetry: {
            tokensIn: 9_760_000,
            maxInputTokensInTurn: 205_000,
            turns: 37,
            failReason: 'prompt_overflow',
          },
        },
      }],
    )
    expect(failure).toEqual({
      failReason: 'max_turns_paused: attempt input tokens per turn 205000 exceeded cap 180000',
      tokensIn: 9_760_000,
      maxInputTokensInTurn: 205_000,
      turns: 37,
    })
  })

  it('resolvePriorAttemptFailure falls back to a frozen run row when evidence is missing', () => {
    const failure = resolvePriorAttemptFailure(run({ failReason: 'max_turns_paused: attempt input tokens per turn 205000 exceeded cap 180000', tokensIn: 9_760_000 }))
    expect(failure).toEqual({
      failReason: 'max_turns_paused: attempt input tokens per turn 205000 exceeded cap 180000',
      tokensIn: 9_760_000,
      maxInputTokensInTurn: 9_760_000,
      turns: 0,
    })
  })

  it('resolvePriorAttemptFailure returns null when the run has no usable signal', () => {
    expect(resolvePriorAttemptFailure(run({ failReason: null, tokensIn: 0 }))).toBeNull()
    expect(resolvePriorAttemptFailure(run({ failReason: '', tokensIn: 100 }))).toBeNull()
    expect(resolvePriorAttemptFailure(run({ failReason: 'prompt_overflow', tokensIn: 0, costUsd: 0 }))).toBeNull()
  })
})

function task(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: createId<'TaskId'>(),
    specId: createId<'SpecId'>(),
    targetId: null,
    name: 'demo-task',
    prompt: 'Implement the demo task.',
    repos: ['ductum'],
    assignedAgentId: null,
    requiredRole: null,
    complexity: 'simple',
    status: 'ready',
    strategyRole: 'normal',
    strategyGroup: null,
    verification: ['pnpm test'],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function run(overrides: Partial<Run> = {}): Run {
  const now = new Date().toISOString()
  return {
    id: createId<'RunId'>(),
    taskId: createId<'TaskId'>(),
    agentId: createId<'AgentId'>(),
    parentRunId: null,
    stage: 'implement',
    terminalState: 'frozen',
    resetCount: 0,
    completedStages: [],
    blockedReason: null,
    pendingApproval: false,
    sessionId: null,
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
    lastHeartbeat: now,
    heartbeatTimeoutSeconds: 120,
    verifyRetries: 0,
    completionSummary: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

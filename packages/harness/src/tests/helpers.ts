import type { Agent, Run, Task } from '@ductum/core'

export interface MockMessage {
  type: 'result' | 'system' | 'assistant'
  subtype?: string
  session_id: string
  message?: {
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    content?: unknown[]
  }
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  result?: string
  total_cost_usd?: number
  is_error?: boolean
  terminal_reason?: string
}

export type Step =
  | { type: 'message'; value: MockMessage }
  | { type: 'error'; error: Error }
  | { type: 'hang' }

export class MockClaudeQuery {
  closed = false
  private index = 0
  private unblock: (() => void) | null = null

  constructor(private readonly steps: Step[]) {}

  async next(): Promise<IteratorResult<MockMessage, void>> {
    if (this.closed) {
      return { done: true, value: undefined }
    }

    const step = this.steps[this.index++]
    if (step == null) {
      return { done: true, value: undefined }
    }
    if (step.type === 'message') {
      return { done: false, value: step.value }
    }
    if (step.type === 'error') {
      throw step.error
    }

    await new Promise<void>((resolve) => {
      this.unblock = resolve
    })
    return { done: true, value: undefined }
  }

  close(): void {
    this.closed = true
    this.unblock?.()
  }

  [Symbol.asyncIterator](): MockClaudeQuery {
    return this
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1' as Agent['id'],
    name: 'mimi',
    model: 'claude-opus-4.6',
    harness: 'claude-agent-sdk',
    capabilities: [],
    costTier: 90,
    spawnConfig: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

export function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1' as Run['id'],
    taskId: 'task-1' as Run['taskId'],
    agentId: 'agent-1' as Run['agentId'],
    parentRunId: null,
    stage: 'implement',
    terminalState: null,
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
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: null,
    heartbeatTimeoutSeconds: 120,
    completionSummary: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
    verifyRetries: overrides.verifyRetries ?? 0,
    runtimeModel: overrides.runtimeModel ?? null,
    runtimeHarness: overrides.runtimeHarness ?? null,
    runtimeSandboxProfile: overrides.runtimeSandboxProfile ?? null,
    runtimeWorkflowProfile: overrides.runtimeWorkflowProfile ?? null,
  }
}

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1' as Task['id'],
    specId: 'spec-1' as Task['specId'],
    name: 'Claude adapter',
    prompt: 'Implement the Claude harness adapter.',
    repos: ['packages/harness'],
    assignedAgentId: 'agent-1' as Task['assignedAgentId'],
    requiredRole: null,
    complexity: null,
    status: 'active',
    verification: ['pnpm test'],
    retryCount: 0,
    retryAfter: null,
    budgetExtraUsd: 0,
    turnExtraCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
    targetId: overrides.targetId ?? null,
    strategyRole: overrides.strategyRole ?? 'normal',
    strategyGroup: overrides.strategyGroup ?? null,
  }
}

import type { Decision, Evidence, Run, RunId, RunUpdate, Task } from '@ductum/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { vi } from 'vitest'

import type { DuctumApi } from '../api-client.js'
import { DuctumMcpServer } from '../server.js'
import type { RunContext } from '../types.js'

const now = '2026-04-04T12:00:00.000Z'

export const task: Task = {
  id: 'task-1' as Task['id'],
  specId: 'spec-1' as Task['specId'],
  targetId: null,
  name: 'P5',
  prompt: 'Implement P5',
  repos: ['packages/mcp'],
  assignedAgentId: 'agent-1' as Task['assignedAgentId'],
  requiredRole: null,
  complexity: null,
  strategyRole: 'normal',
  strategyGroup: null,
  status: 'ready',
  verification: ['pnpm test'],
  retryCount: 0,
  retryAfter: null,
  budgetExtraUsd: 0,
  turnExtraCount: 0,
  createdAt: now,
  updatedAt: now,
}

export function createRun(
  stage: Run['stage'] = 'understand',
  id = 'run-1',
  options?: { terminalState?: Run['terminalState'] },
): Run {
  return {
    id: id as RunId,
    taskId: task.id,
    agentId: 'agent-1' as Run['agentId'],
    parentRunId: null,
    stage,
    terminalState: options?.terminalState ?? null,
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
  }
}

export function createDecision(): Decision {
  return {
    id: 'decision-1' as Decision['id'],
    specId: task.specId,
    taskId: task.id,
    runId: 'run-1' as Decision['runId'],
    decision: 'Use MCP',
    context: 'Matches spec',
    alternatives: ['CLI'],
    decidedBy: 'agent',
    supersedesId: null,
    createdAt: now,
  }
}

export function createEvidence(): Evidence {
  return {
    id: 'evidence-1' as Evidence['id'],
    runId: 'run-1' as Evidence['runId'],
    type: 'test',
    payload: { command: 'pnpm test' },
    createdAt: now,
  }
}

export function createUpdate(): RunUpdate {
  return {
    id: 1,
    runId: 'run-1' as RunUpdate['runId'],
    message: 'Working on it',
    createdAt: now,
  }
}

export function createContext(stage: Run['stage'] = 'implement', terminalState?: Run['terminalState']): RunContext {
  return {
    task,
    run: createRun(stage, 'run-1', { terminalState: terminalState ?? null }),
    history: [],
    evidence: [],
    gateEvaluations: [],
    progressUpdates: [],
    git: {
      branch: 'feat/p5-mcp',
      commitSha: 'abc123',
      prNumber: null,
      prUrl: null,
    },
  }
}

export function createMockApi(overrides: Partial<DuctumApi> = {}): DuctumApi {
  return {
    nextTask: vi.fn().mockResolvedValue(task),
    getTask: vi.fn().mockResolvedValue(task),
    accept: vi.fn().mockResolvedValue({ run: createRun(), task }),
    complete: vi.fn().mockResolvedValue(createRun('done')),
    update: vi.fn().mockResolvedValue(createUpdate()),
    heartbeat: vi.fn().mockResolvedValue(createRun('implement')),
    decide: vi.fn().mockResolvedValue(createDecision()),
    gateCheck: vi.fn().mockResolvedValue({ allowed: true, stage: 'understand' }),
    getWorkflowInfo: vi.fn().mockResolvedValue({ activeStage: 'understand', completedStages: [], stages: [] }),
    fail: vi.fn().mockResolvedValue(createRun('implement')),
    evidence: vi.fn().mockResolvedValue(createEvidence()),
    link: vi.fn().mockResolvedValue(createRun('implement')),
    getContext: vi.fn().mockResolvedValue(createContext()),
    postActivity: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

export async function connectHarness(
  api: DuctumApi,
  connections: Array<{ close: () => Promise<void> }>,
  preBoundRunId?: RunId,
) {
  const server = new DuctumMcpServer(api, preBoundRunId)
  const client = new Client({ name: 'ductum-test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  connections.push({
    close: async () => {
      await Promise.allSettled([client.close(), server.close()])
    },
  })
  return { client, server }
}

export function firstText(result: unknown): string {
  const content =
    typeof result === 'object' && result != null && 'content' in result
      ? (result as { content?: unknown }).content
      : undefined
  const blocks = Array.isArray(content) ? content : []
  const first = blocks[0]
  return typeof first === 'object' && first != null && 'text' in first && typeof first.text === 'string'
    ? first.text
    : ''
}

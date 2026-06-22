import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, Task } from '@ductum/core'
import { describe, expect, it, vi } from 'vitest'

import type { BakeoffCompareResponse } from '../types.js'
import { agent, createMockApi, project, readyTask, runCommand, spec } from './helpers.js'

describe('spec bakeoff create command', () => {
  it('creates a bakeoff with agent IDs and prints the created work', async () => {
    const promptFile = await writePromptFile('Implement the best patch.')
    const builderA = makeAgent('agent-builder-a', 'codex', 'gpt-5.5')
    const builderB = makeAgent('agent-builder-b', 'glm', 'glm-5.2')
    const reviewer = makeAgent('agent-reviewer', 'opus', 'claude-opus-4.8')
    const resultPayload = bakeoffResult([builderA, builderB], reviewer)
    const api = createMockApi({
      listAgents: vi.fn().mockResolvedValue([builderA, builderB, reviewer]),
      createBakeoff: vi.fn().mockResolvedValue(resultPayload),
    })
    try {
      const result = await runCommand([
        'spec',
        'bakeoff',
        'create',
        project.name,
        'Best patch',
        '--prompt-file',
        promptFile.file,
        '--builders',
        'codex,glm',
        '--reviewer',
        'opus',
        '--policy',
        'quality-gated-cost-aware',
        '--verify',
        'pnpm test',
        '--verify',
        'pnpm lint,pnpm build',
      ], api)

      expect(result.code).toBe(0)
      expect(api.createBakeoff).toHaveBeenCalledWith(project.id, {
        name: 'Best patch',
        prompt: 'Implement the best patch.',
        builderAgentIds: [builderA.id, builderB.id],
        reviewerAgentId: reviewer.id,
        policy: 'quality-gated-cost-aware',
        verify: ['pnpm test', 'pnpm lint', 'pnpm build'],
      })
      expect(result.text).toContain('Bakeoff created')
      expect(result.text).toContain(resultPayload.spec.id)
      expect(result.text).toContain(resultPayload.strategyGroup)
      expect(result.text).toContain('candidate-codex')
      expect(result.text).toContain('task-review')
      expect(result.text).toContain(resultPayload.nextCommands.compare)
    } finally {
      await rm(promptFile.dir, { recursive: true, force: true })
    }
  })

  it('rejects fewer than two builders before calling the API', async () => {
    const api = createMockApi({ createBakeoff: vi.fn() })

    const result = await runCommand([
      'spec',
      'bakeoff',
      'create',
      project.name,
      'Too small',
      '--prompt-file',
      '/unused',
      '--builders',
      agent.name,
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('at least two builders')
    expect(api.createBakeoff).not.toHaveBeenCalled()
  })

  it('rejects duplicate builder names before calling the API', async () => {
    const api = createMockApi({ createBakeoff: vi.fn() })

    const result = await runCommand([
      'spec',
      'bakeoff',
      'create',
      project.name,
      'Duplicate',
      '--prompt-file',
      '/unused',
      '--builders',
      'mimi,mimi',
    ], api)

    expect(result.code).toBe(1)
    expect(result.errorText).toContain('Duplicate builder agent: mimi')
    expect(api.createBakeoff).not.toHaveBeenCalled()
  })

  it('rejects duplicate resolved builder agents before calling the API', async () => {
    const promptFile = await writePromptFile('Do it.')
    const builder = makeAgent('agent-builder-a', 'codex', 'gpt-5.5')
    const alias = { ...builder, name: 'codex-alias' }
    const other = makeAgent('agent-builder-b', 'glm', 'glm-5.2')
    const api = createMockApi({
      listAgents: vi.fn().mockResolvedValue([builder, alias, other]),
      createBakeoff: vi.fn(),
    })
    try {
      const result = await runCommand([
        'spec',
        'bakeoff',
        'create',
        project.name,
        'Duplicate resolved',
        '--prompt-file',
        promptFile.file,
        '--builders',
        'codex,codex-alias,glm',
      ], api)

      expect(result.code).toBe(1)
      expect(result.errorText).toContain('Duplicate builder agent')
      expect(api.createBakeoff).not.toHaveBeenCalled()
    } finally {
      await rm(promptFile.dir, { recursive: true, force: true })
    }
  })

  it('rejects an explicit reviewer that uses a builder model', async () => {
    const promptFile = await writePromptFile('Do it.')
    const builderA = makeAgent('agent-builder-a', 'codex', 'gpt-5.5')
    const builderB = makeAgent('agent-builder-b', 'glm', 'glm-5.2')
    const reviewer = makeAgent('agent-reviewer', 'reviewer', 'gpt-5.5')
    const api = createMockApi({
      listAgents: vi.fn().mockResolvedValue([builderA, builderB, reviewer]),
      createBakeoff: vi.fn(),
    })
    try {
      const result = await runCommand([
        'spec',
        'bakeoff',
        'create',
        project.name,
        'Bad reviewer',
        '--prompt-file',
        promptFile.file,
        '--builders',
        'codex,glm',
        '--reviewer',
        'reviewer',
      ], api)

      expect(result.code).toBe(1)
      expect(result.errorText).toContain('Reviewer model must differ from every builder model')
      expect(api.createBakeoff).not.toHaveBeenCalled()
    } finally {
      await rm(promptFile.dir, { recursive: true, force: true })
    }
  })

  it('prints compare metrics, verdict, and normal approval next action', async () => {
    const compare = bakeoffCompareResult()
    const api = createMockApi({
      getBakeoffCompare: vi.fn().mockResolvedValue(compare),
    })

    const result = await runCommand(['spec', 'bakeoff', 'compare', compare.spec.id], api)

    expect(result.code).toBe(0)
    expect(api.getBakeoffCompare).toHaveBeenCalledWith(compare.spec.id)
    expect(result.text).toContain('Bakeoff compare')
    expect(result.text).toContain('candidate-codex')
    expect(result.text).toContain('gpt-5.5')
    expect(result.text).toContain('$1.25')
    expect(result.text).toContain('8.8')
    expect(result.text).toContain('winner passed review and verification')
    expect(result.text).toContain('ductum approve run-winner')
    expect(result.text).toContain('malformedReviews')
  })
})

function makeAgent(id: string, name: string, model: string): Agent {
  return {
    ...agent,
    id: id as Agent['id'],
    name,
    model,
  }
}

function bakeoffResult(builders: Agent[], reviewer: Agent) {
  const candidates = builders.map((builder) => ({
    ...readyTask,
    id: `task-${builder.name}` as Task['id'],
    name: `candidate-${builder.name}`,
    assignedAgentId: builder.id,
    strategyRole: 'candidate' as const,
    strategyGroup: 'strategy-bon',
  }))
  const reviewTask = {
    ...readyTask,
    id: 'task-review' as Task['id'],
    name: 'blind-review',
    assignedAgentId: reviewer.id,
    requiredRole: 'reviewer' as const,
    status: 'blocked' as const,
    strategyRole: 'blind_review' as const,
    strategyGroup: 'strategy-bon',
  }
  return {
    spec: { ...spec, id: 'spec-bakeoff' as typeof spec.id, name: 'Best patch', strategy: 'best_of_n' as const },
    candidates,
    reviewTask,
    dependencies: candidates.map((candidate) => ({ taskId: reviewTask.id, dependsOnId: candidate.id })),
    policy: 'quality-gated-cost-aware',
    strategyGroup: 'strategy-bon',
    reviewer,
    builders,
    nextCommands: {
      watch: 'ductum task list spec-bakeoff',
      compare: 'ductum spec bakeoff compare spec-bakeoff',
    },
  }
}

function bakeoffCompareResult(): BakeoffCompareResponse {
  return {
    spec: { id: 'spec-bakeoff', projectId: project.id, name: 'Best patch', status: 'approved' },
    policy: 'quality-gated-cost-aware',
    strategyGroup: 'strategy-bon',
    status: 'complete',
    candidates: [
      {
        task: summaryTask('task-codex', 'candidate-codex', 'run-winner', true),
        agent: { id: 'agent-builder-a', name: 'codex', model: 'gpt-5.5', modelLabel: 'GPT 5.5', provider: 'openai', harness: 'codex-sdk', effort: null, costTier: 40 },
        metrics: { tokensIn: 1000, tokensOut: 200, totalTokens: 1200, costUsd: 1.25, elapsedSeconds: 60, startedAt: null, updatedAt: null, attempts: 1, reviewPasses: 1, fixRounds: 0, verificationFailures: 0 },
        scores: { implementation: 10, review: 9, tests: 10, costEfficiency: 0, overall: 8.8, reviewerConfidence: 0.86 },
        outcome: 'accepted',
        verdictScore: { taskId: 'task-codex', passed: true, confidence: 0.86, notes: 'cleaner implementation' },
        winner: true,
        eligibility: { eligible: true, gates: {}, blockingReasons: [] },
      },
      {
        task: summaryTask('task-glm', 'candidate-glm', 'run-loser', false),
        agent: { id: 'agent-builder-b', name: 'glm', model: 'glm-5.2', modelLabel: 'GLM 5.2', provider: 'zai', harness: 'codex-sdk', effort: null, costTier: 10 },
        metrics: { tokensIn: 500, tokensOut: 100, totalTokens: 600, costUsd: 0.1, elapsedSeconds: 45, startedAt: null, updatedAt: null, attempts: 1, reviewPasses: 0, fixRounds: 0, verificationFailures: 1 },
        scores: { implementation: 10, review: 0, tests: 0, costEfficiency: 0, overall: 0, reviewerConfidence: 0.2 },
        outcome: 'rejected',
        verdictScore: { taskId: 'task-glm', passed: false, confidence: 0.2, notes: 'verification failed' },
        winner: false,
        eligibility: { eligible: false, gates: {}, blockingReasons: ['candidate review has not passed'] },
      },
    ],
    reviewTask: summaryTask('task-review', 'blind-review', 'run-review', false),
    verdict: {
      kind: 'best-of-n-verdict',
      winnerTaskId: 'task-codex',
      scores: [
        { taskId: 'task-codex', passed: true, notes: 'cleaner implementation' },
        { taskId: 'task-glm', passed: false, notes: 'verification failed' },
      ],
      policy: 'quality-gated-cost-aware',
      reason: 'winner passed review and verification',
    },
    winner: { taskId: 'task-codex', runId: 'run-winner', outcome: 'accepted', eligible: true },
    eligibility: { eligibleCount: 1, blockedCount: 1 },
    stats: {
      totals: { role: 'total', key: 'total', agentName: null, model: 'all', attempts: 3, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 1.35, totalTokens: 1800, winner: true, humanOverride: false, failureCategory: null, judge: 'opus' },
      perModel: [
        { role: 'builder', key: 'codex', agentName: 'codex', model: 'gpt-5.5', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 1.25, totalTokens: 1200, winner: true, humanOverride: false, failureCategory: null },
        { role: 'builder', key: 'glm', agentName: 'glm', model: 'glm-5.2', attempts: 1, passed: false, failed: true, malformedRate: 0, reviewPassRate: 0, costUsd: 0.1, totalTokens: 600, winner: false, humanOverride: false, failureCategory: 'review_failure' },
      ],
      perJudge: [{ role: 'judge', key: 'opus', agentName: 'opus', model: 'claude-opus-4.8', attempts: 1, passed: true, failed: false, malformedRate: 0, reviewPassRate: 1, costUsd: 0, totalTokens: 0, winner: false, humanOverride: false, failureCategory: null, judge: 'opus' }],
    } as unknown as BakeoffCompareResponse['stats'],
    malformed: { reviewCount: 0, recoveryState: null },
    nextActions: ['Review candidate task-codex; approve through the normal Ductum approval flow if it should ship.'],
  }
}

function summaryTask(taskId: string, taskName: string, latestRunId: string, pendingApproval: boolean) {
  return {
    taskId, taskName, taskStatus: 'done' as const, runIds: [latestRunId],
    latestRunId, latestRunStage: pendingApproval ? 'ship' as const : 'done' as const,
    terminalState: null, blockedReason: null, failReason: null, pendingApproval,
    branch: `ductum/${taskName}`,
    commitSha: 'abc123',
    prUrl: null,
    worktreePaths: [`/tmp/${taskName}`],
  }
}

async function writePromptFile(prompt: string) {
  const dir = await mkdtemp(join(tmpdir(), 'ductum-bakeoff-'))
  const file = join(dir, 'prompt.md')
  await writeFile(file, prompt, 'utf8')
  return { dir, file }
}

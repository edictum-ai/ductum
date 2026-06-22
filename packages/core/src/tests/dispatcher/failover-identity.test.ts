import {
  createFixture,
  createId,
  createTask,
  describe,
  expect,
  it,
} from './shared.js'
import type { HarnessSessionResult } from '../../dispatcher-support.js'
import type { Agent, Run } from '../../types.js'

async function settle(): Promise<void> {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

function recoverableExternal(detail: string): HarnessSessionResult {
  return {
    exitReason: 'failed',
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    failReason: detail,
    failureEvidence: { category: 'recoverable-external' },
  }
}

function latestRun(fixture: ReturnType<typeof createFixture>, taskId: Run['taskId'], excludeId: Run['id']): Run {
  return fixture.context.runRepo.list(taskId).find((run) => run.id !== excludeId)!
}

function createFallbackAgent(fixture: ReturnType<typeof createFixture>, fields: Partial<Agent>): Agent {
  const agent = fixture.context.agentRepo.create({
    id: createId<'AgentId'>(),
    name: fields.name ?? 'fallback',
    model: fields.model ?? fixture.builder.model,
    harness: fields.harness ?? fixture.builder.harness,
    providerId: fields.providerId ?? null,
    accountId: fields.accountId ?? null,
    capabilities: fields.capabilities ?? ['build'],
    costTier: fields.costTier ?? 70,
    spawnConfig: fields.spawnConfig ?? {},
  })
  fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: agent.id, role: 'builder' })
  return agent
}

describe('Dispatcher failover provider/account identity', () => {
  it('allows same-harness failover when provider/account identity differs', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, { providerId: 'anthropic', accountId: 'acct-primary' })
    const fallback = createFallbackAgent(fixture, {
      name: 'same-harness-backup',
      providerId: 'anthropic',
      accountId: 'acct-secondary',
    })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 out of credits'))
    await settle()

    expect(latestRun(fixture, task.id, run.id).agentId).toBe(fallback.id)
    expect(fixture.builderHarness.adapter.spawn).toHaveBeenCalledTimes(2)
  })

  it('rejects different-harness failover when provider/account identity matches', async () => {
    const fixture = createFixture()
    fixture.context.agentRepo.update(fixture.builder.id, { providerId: 'openai', accountId: 'acct-shared' })
    fixture.context.agentRepo.update(fixture.reviewer.id, { providerId: 'openai', accountId: 'acct-shared' })
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('401 invalid api key'))
    await settle()

    const source = fixture.context.runRepo.get(run.id)!
    expect(source.terminalState).toBe('frozen')
    expect(source.failReason).toMatch(/no fallback/)
    expect(fixture.reviewerHarness.adapter.spawn).not.toHaveBeenCalled()
    expect(fixture.context.runRepo.list(task.id)).toHaveLength(1)
  })

  it('keeps legacy harness fallback when provider/account identity is missing', async () => {
    const fixture = createFixture()
    fixture.context.projectAgentRepo.assign({ projectId: fixture.project.id, agentId: fixture.reviewer.id, role: 'builder' })
    const task = createTask(fixture, { assignedAgentId: fixture.builder.id })

    await fixture.dispatcher.cycle()
    const run = fixture.context.runRepo.list(task.id)[0]!
    fixture.builderHarness.sessions[0]!.done.resolve(recoverableExternal('402 out of credits'))
    await settle()

    expect(latestRun(fixture, task.id, run.id).agentId).toBe(fixture.reviewer.id)
    expect(fixture.reviewerHarness.adapter.spawn).toHaveBeenCalled()
  })
})

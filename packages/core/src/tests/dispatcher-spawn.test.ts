import { spawn } from 'node:child_process'

import { afterEach } from 'vitest'

import { createTask, createFixture, createId, describe, expect, flush, it, seedImplRun } from './dispatcher/shared.js'
import type { Agent } from '../types.js'

const spawnedPids = new Set<number>()

afterEach(async () => {
  for (const pid of [...spawnedPids]) {
    try { process.kill(-pid, 'SIGKILL') } catch {}
    try { process.kill(pid, 'SIGKILL') } catch {}
    spawnedPids.delete(pid)
  }
})

function addBackupBuilder(fixture: ReturnType<typeof createFixture>): Agent {
  const backup = fixture.context.agentRepo.create({
    id: createId<'AgentId'>(),
    name: 'sonnet',
    model: 'claude-sonnet-4.6',
    harness: 'claude-agent-sdk',
    capabilities: ['build', 'test'],
    costTier: 95,
    spawnConfig: { workingDir: '/tmp/ductum' },
  })
  fixture.context.projectAgentRepo.assign({
    projectId: fixture.project.id,
    agentId: backup.id,
    role: 'builder',
  })
  return backup
}

function advance(fixture: ReturnType<typeof createFixture>, ms: number): void {
  fixture.nowRef.value = new Date(new Date(fixture.nowRef.value).getTime() + ms).toISOString()
}

async function failPrimaryOnce(fixture: ReturnType<typeof createFixture>): Promise<void> {
  const task = createTask(fixture, { name: `failure ${fixture.builderHarness.sessions.length + 1}` })
  const result = await fixture.dispatcher.cycleOnce()
  expect(result.tasksDispatched).toEqual([task.id])
  const session = fixture.builderHarness.sessions.at(-1)!
  const run = fixture.context.runRepo.get(session.runId)!
  expect(run.agentId).toBe(fixture.builder.id)
  session.done.resolve({
    exitReason: 'failed',
    failReason: 'prompt_overflow',
    failureEvidence: { signature: 'Prompt is too long' },
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  })
  await flush()
}

async function makePrimaryUnhealthy(fixture: ReturnType<typeof createFixture>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await failPrimaryOnce(fixture)
    advance(fixture, 10_000)
  }
}

describe('dispatcher agent health rotation', () => {
  it('routes to a different capable agent after three recoverable failures', async () => {
    const fixture = createFixture()
    const backup = addBackupBuilder(fixture)

    await makePrimaryUnhealthy(fixture)

    const health = fixture.dispatcher.getAgentHealth().find((entry) => entry.agentId === fixture.builder.id)
    expect(health).toMatchObject({
      recentFailures: 3,
      unhealthy: true,
      unhealthyReason: '3 recent failures: prompt_overflow',
    })

    const task = createTask(fixture, { name: 'rotates around unhealthy agent' })
    const result = await fixture.dispatcher.cycleOnce()
    expect(result.tasksDispatched).toEqual([task.id])

    const session = fixture.builderHarness.sessions.at(-1)!
    const run = fixture.context.runRepo.get(session.runId)!
    expect(run.agentId).toBe(backup.id)
  })

  it('lets the original agent run again after the five-minute cool-off', async () => {
    const fixture = createFixture()
    addBackupBuilder(fixture)

    await makePrimaryUnhealthy(fixture)
    advance(fixture, 5 * 60_000 + 1)

    const health = fixture.dispatcher.getAgentHealth().find((entry) => entry.agentId === fixture.builder.id)
    expect(health?.unhealthy).toBe(false)
    expect(health?.recentFailures).toBe(3)

    const task = createTask(fixture, { name: 'after cool-off' })
    const result = await fixture.dispatcher.cycleOnce()
    expect(result.tasksDispatched).toEqual([task.id])

    const session = fixture.builderHarness.sessions.at(-1)!
    const run = fixture.context.runRepo.get(session.runId)!
    expect(run.agentId).toBe(fixture.builder.id)
  })

  it('clears unhealthy state on manual reset', async () => {
    const fixture = createFixture()
    addBackupBuilder(fixture)

    await makePrimaryUnhealthy(fixture)

    expect(fixture.dispatcher.resetAgentHealth(fixture.builder.name)).toBe(true)
    const health = fixture.dispatcher.getAgentHealth().find((entry) => entry.agentId === fixture.builder.id)
    expect(health).toMatchObject({ recentFailures: 0, unhealthy: false })

    const task = createTask(fixture, { name: 'after reset' })
    const result = await fixture.dispatcher.cycleOnce()
    expect(result.tasksDispatched).toEqual([task.id])

    const session = fixture.builderHarness.sessions.at(-1)!
    const run = fixture.context.runRepo.get(session.runId)!
    expect(run.agentId).toBe(fixture.builder.id)
  })
})

describe('dispatcher stale slot GC', () => {
  it('auto-closes old active run rows that have no live session', async () => {
    const fixture = createFixture()
    const events: unknown[] = []
    fixture.eventEmitter.subscribe((event) => events.push(event))
    const { task, run } = seedImplRun(fixture, 'stale-slot', {
      lastHeartbeat: '2026-04-04T11:55:59.000Z',
      heartbeatTimeoutSeconds: 120,
    })

    const result = await fixture.dispatcher.cycleOnce()
    expect(result.tasksDispatched).toEqual([])

    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: 'stalled',
      failReason: 'stale_slot_gc',
    })
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('failed')
    expect(fixture.watcherManager.stopWatchers).toHaveBeenCalledWith(run.id, 'stale slot auto-closed')
    expect(events).toContainEqual({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
  })

  it('reaps a ductum-owned worker before auto-closing a stale slot', async () => {
    if (process.platform === 'win32') return
    const fixture = createFixture()
    const workerPid = spawnDetachedWorker()
    const { run } = seedImplRun(fixture, 'stale-slot-worker', {
      lastHeartbeat: '2026-04-04T11:55:59.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.context.sessionRunMappingRepo.create({
      sessionId: 'stale-worker-session',
      runId: run.id,
      harness: 'claude-agent-sdk',
      workingDir: '/tmp/stale-worker',
      harnessSessionId: 'stale-worker-harness',
      workerPid,
      workerOwnershipKind: 'process-group',
      workerStartedAt: new Date().toISOString(),
      workerOwnershipUnsupportedReason: null,
    })

    const result = await fixture.dispatcher.cycleOnce()

    expect(result.tasksDispatched).toEqual([])
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      terminalState: 'stalled',
      failReason: 'stale_slot_gc',
    })
    await waitForExit(workerPid)
    expect(isProcessAlive(workerPid)).toBe(false)
  })

  it('does not auto-close ship runs waiting for approval', async () => {
    const fixture = createFixture()
    const events: unknown[] = []
    fixture.eventEmitter.subscribe((event) => events.push(event))
    const { task, run } = seedImplRun(fixture, 'approval-ready-slot', {
      lastHeartbeat: '2026-04-04T11:55:59.000Z',
      heartbeatTimeoutSeconds: 120,
    })
    fixture.context.runRepo.updateStage(run.id, 'ship')
    fixture.context.runRepo.updateWorkflowState(run.id, {
      blockedReason: null,
      pendingApproval: true,
    })
    fixture.context.runRepo.updateGitArtifacts(run.id, {
      branch: 'feature/ready',
      commitSha: 'abc123',
    })

    const result = await fixture.dispatcher.cycleOnce()

    expect(result.tasksDispatched).toEqual([])
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      stage: 'ship',
      terminalState: null,
      pendingApproval: true,
      failReason: null,
    })
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('active')
    expect(fixture.watcherManager.stopWatchers).not.toHaveBeenCalled()
    expect(events).not.toContainEqual({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
  })

  it('does not auto-close ship runs that already carry completed-attempt blocker evidence', async () => {
    const fixture = createFixture()
    const events: unknown[] = []
    fixture.eventEmitter.subscribe((event) => events.push(event))
    const { task, run } = seedImplRun(fixture, 'completion-routed-slot', {
      lastHeartbeat: '2026-04-04T11:55:59.000Z',
      heartbeatTimeoutSeconds: 120,
      branch: 'feat/p1-repository-remote-auth-provenance',
      commitSha: 'd5e4792ef08f4ae1b0f856f5daae90c1d430129c',
    })
    fixture.context.runRepo.updateStage(run.id, 'ship')
    fixture.context.runRepo.updateWorkflowState(run.id, {
      blockedReason: 'GitHub App installation auth is missing for repository operations.',
      pendingApproval: false,
    })

    const result = await fixture.dispatcher.cycleOnce()

    expect(result.tasksDispatched).toEqual([])
    expect(fixture.context.runRepo.get(run.id)).toMatchObject({
      stage: 'ship',
      terminalState: null,
      blockedReason: 'GitHub App installation auth is missing for repository operations.',
      pendingApproval: false,
      branch: 'feat/p1-repository-remote-auth-provenance',
      commitSha: 'd5e4792ef08f4ae1b0f856f5daae90c1d430129c',
      failReason: null,
    })
    expect(fixture.context.taskRepo.get(task.id)?.status).toBe('active')
    expect(fixture.watcherManager.stopWatchers).not.toHaveBeenCalled()
    expect(events).not.toContainEqual({ type: 'slot.auto_closed', runId: run.id, reason: 'stale_slot_gc' })
  })
})

function spawnDetachedWorker(): number {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  })
  const pid = child.pid
  if (pid == null) throw new Error('failed to spawn detached worker')
  spawnedPids.add(pid)
  child.unref()
  return pid
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  if (!isProcessAlive(pid)) spawnedPids.delete(pid)
}

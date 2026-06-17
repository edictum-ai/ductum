import { createId } from '@ductum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, seedBase, type TestFixture } from '../helpers.js'

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('API routes - evidence', () => {
  it('accepts typed exit demo evidence rows', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: ['understand', 'implement', 'ship'],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'main',
      commitSha: 'abc1234',
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
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: { type: 'exit_demo.run', payload: exitDemoPayload() },
    })

    expect(result.response.status, result.text).toBe(201)
    expect(result.json).toMatchObject({ type: 'exit_demo.run', payload: { kind: 'exit_demo.run' } })
    expect(fixture.repos.evidence.list(run.id)[0]).toMatchObject({
      type: 'exit_demo.run',
      payload: { kind: 'exit_demo.run' },
    })
  })

  it('rejects malformed typed exit demo evidence rows', async () => {
    fixture = await createFixture()
    const { task, builder } = seedBase(fixture)
    const run = fixture.repos.runs.create({
      id: createId<'RunId'>(),
      taskId: task.id,
      agentId: builder.id,
      parentRunId: null,
      stage: 'done',
      terminalState: null,
      resetCount: 0,
      completedStages: [],
      blockedReason: null,
      pendingApproval: false,
      sessionId: null,
      branch: 'main',
      commitSha: 'abc1234',
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
    })

    const result = await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
      method: 'POST',
      body: { type: 'exit_demo.run', payload: { kind: 'exit_demo.run', schemaVersion: 1, data: {} } },
    })

    expect(result.response.status).toBe(400)
  })
})

function exitDemoPayload() {
  return {
    kind: 'exit_demo.run',
    schemaVersion: 1,
    data: {
      demoName: 'bootstrap-redesign-p5',
      machineSignature: { osHash: 'os', osPlatform: 'darwin', hostnameHash: 'host' },
      timeline: [
        { phase: 'install_g', t: 1000 },
        { phase: 'init_anthropic_auth', t: 2000 },
        { phase: 'serve_ready', t: 3000 },
        { phase: 'spec_imported', t: 4000 },
        { phase: 'run_awaiting_approval', t: 5000 },
        { phase: 'approve_clicked', t: 6000 },
        { phase: 'merged', t: 7000 },
      ],
      totalSeconds: 7,
      mergedCommitSha: 'abc1234',
      mergedBranch: 'main',
      agentName: 'claude-builder',
      promptText: 'Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.',
      operatorActions: ['browser_auth', 'approve_click'],
    },
  }
}

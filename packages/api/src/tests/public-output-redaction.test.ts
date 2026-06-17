import { afterEach, describe, expect, it } from 'vitest'
import { createId, type RepairHostChecks, type Run } from '@ductum/core'

import { createFixture, requestJson, seedBase, type TestFixture } from './helpers.js'

const SECRETS = [
  'sk-ant-api03-test-secret',
  'sk-proj-test-secret',
  'ghp_testsecret',
  'xoxb-test-secret',
  '123456:telegram-secret',
  'Bearer test-secret',
  'postgres://user:password@example.com/db',
  'ANTHROPIC_AUTH_TOKEN=secret',
  'OPENAI_API_KEY=secret',
  'webhook-secret-value',
]

let fixture: TestFixture | undefined

afterEach(() => {
  fixture?.close()
  fixture = undefined
})

describe('API public-output redaction', () => {
  it('redacts secrets from public JSON while keeping readiness metadata', async () => {
    const repairChecks: Partial<RepairHostChecks> = {
      git: ready('Git is installed'),
      factoryDataDir: ready('/tmp/ductum'),
      localApp: ready('API reachable on 4100'),
      providerAuth: {
        anthropic: {
          state: 'configured',
          label: 'ANTHROPIC_AUTH_TOKEN',
          detail: `Anthropic auth loaded from ANTHROPIC_AUTH_TOKEN with sk-ant-api03-test-secret`,
        },
      },
      repositories: {},
    }
    fixture = await createFixture({ repairChecks, getDispatcherStatus: dispatcherStatus })
    const { builder, task } = seedBase(fixture)
    fixture.repos.agents.update(builder.id, {
      spawnConfig: {
        env: {
          OPENAI_API_KEY: 'sk-proj-test-secret',
          ANTHROPIC_AUTH_TOKEN: '${ANTHROPIC_AUTH_TOKEN}',
          SLACK_BOT_TOKEN: 'xoxb-test-secret',
        },
      },
    })
    fixture.repos.configResources.create({
      id: createId<'ConfigResourceId'>(),
      kind: 'NotificationChannel',
      projectId: null,
      name: 'ops',
      spec: {
        backend: 'telegram',
        config: {
          botToken: '123456:telegram-secret',
          webhookSecret: 'webhook-secret-value',
          authHeader: 'Bearer test-secret',
        },
      },
    })
    const run = createRun(fixture, task.id, builder.id, {
      blockedReason: 'blocked by xoxb-test-secret',
      failReason: 'failed with ghp_testsecret',
    })

    const responses = [
      ['factory settings', await requestJson(fixture.app, '/api/factory-settings')],
      ['agents', await requestJson(fixture.app, '/api/agents')],
      ['notification resources', await requestJson(fixture.app, '/api/resources/NotificationChannel?projectId=factory')],
      ['repair', await requestJson(fixture.app, '/api/repair')],
      ['run', await requestJson(fixture.app, `/api/runs/${run.id}`)],
      ['attempt', await requestJson(fixture.app, `/api/attempts/${run.id}`)],
      ['create evidence', await requestJson(fixture.app, `/api/runs/${run.id}/evidence`, {
        method: 'POST',
        body: {
          type: 'custom',
          payload: {
            kind: 'operator-note',
            note: `operator saw ${SECRETS.join(' ')}`,
            encryptedSecret: { ciphertext: 'secret-ciphertext-value', authTag: 'secret-auth-tag', keyId: 'local:key-id' },
          },
        },
      })],
      ['create update', await requestJson(fixture.app, `/api/runs/${run.id}/update`, {
        method: 'POST',
        body: { message: `update saw ${SECRETS.join(' ')}` },
      })],
      ['create activity', await requestJson(fixture.app, `/api/runs/${run.id}/activity`, {
        method: 'POST',
        body: { kind: 'tool_call', content: `activity saw ${SECRETS.join(' ')}`, toolName: 'OPENAI_API_KEY=secret' },
      })],
      ['evidence', await requestJson(fixture.app, `/api/runs/${run.id}/evidence`)],
      ['updates', await requestJson(fixture.app, `/api/runs/${run.id}/updates`)],
      ['activity', await requestJson(fixture.app, `/api/runs/${run.id}/activity`)],
    ] as const

    for (const [label, response] of responses) {
      expect(response.response.status, `${label}: ${response.text}`).toBeLessThan(400)
    }
    const output = JSON.stringify(responses.map(([, response]) => response.json))
    for (const secret of SECRETS) expect(output).not.toContain(secret)
    expect(output).not.toContain('secret-ciphertext-value')
    expect(output).not.toContain('secret-auth-tag')
    expect(output).not.toContain('local:key-id')
    expect(output).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(output).toContain('${ANTHROPIC_AUTH_TOKEN}')
    expect(output).toContain('[redacted]')
  })
})

function createRun(
  testFixture: TestFixture,
  taskId: Run['taskId'],
  agentId: Run['agentId'],
  overrides: Partial<Run> = {},
): Run {
  return testFixture.repos.runs.create({
    id: createId<'RunId'>(),
    taskId,
    agentId,
    parentRunId: null,
    stage: 'understand',
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
    runtimeSandboxProfile: null,
    runtimeWorkflowProfile: null,
    ciStatus: null,
    reviewStatus: null,
    failReason: null,
    recoverable: true,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    lastHeartbeat: '2026-06-09T12:00:00.000Z',
    heartbeatTimeoutSeconds: 120,
    ...overrides,
  })
}

function ready(label: string) {
  return { state: 'configured' as const, label, detail: label }
}

function dispatcherStatus() {
  return {
    running: true,
    activeRuns: 0,
    maxConcurrentRuns: 3,
    lastCycleAt: '2026-06-09T12:00:00.000Z',
    enabled: true,
    adapterCount: 1,
    adapters: ['codex-sdk'],
    reason: null,
  }
}

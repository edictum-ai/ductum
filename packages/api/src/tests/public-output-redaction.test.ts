import { afterEach, describe, expect, it, vi } from 'vitest'
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
  vi.unstubAllEnvs()
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

  it('reports provider harness doctor readiness without leaking route secrets', async () => {
    vi.stubEnv('ZAI_API_KEY', 'sk-zai-secret-do-not-print')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.z.ai/api/anthropic')
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'gho_secret-do-not-print')
    fixture = await createFixture({ getDispatcherStatus: dispatcherStatus })
    const { builder, reviewer } = seedBase(fixture)
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'glm-5.2', spec: { provider: 'zai', modelId: 'glm-5.2' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Model', projectId: null, name: 'github-copilot-gpt-5-4', spec: { provider: 'github-copilot', modelId: 'gpt-5.4' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'claude-agent-sdk', spec: { type: 'claude-agent-sdk', command: '/bin/echo' } })
    fixture.repos.configResources.create({ id: createId<'ConfigResourceId'>(), kind: 'Harness', projectId: null, name: 'copilot-sdk', spec: { type: 'copilot-sdk', command: '/bin/echo' } })
    fixture.repos.agents.update(builder.id, { model: 'glm-5.2', harness: 'claude-agent-sdk', resourceRefs: { modelRef: 'glm-5.2', harnessRef: 'claude-agent-sdk' } })
    fixture.repos.agents.update(reviewer.id, { model: 'gpt-5.4', harness: 'copilot-sdk', resourceRefs: { modelRef: 'github-copilot-gpt-5-4', harnessRef: 'copilot-sdk' } })

    const response = await requestJson(fixture.app, '/api/factory/doctor')
    expect(response.response.status).toBe(200)
    expect(response.text).toContain('glm-5.2')
    expect(response.text).toContain('providerId\":\"zai')
    expect(response.text).toContain('ANTHROPIC_BASE_URL')
    expect(response.text).toContain('provider credential env present for github-copilot')
    expect(response.text).toContain('COPILOT_GITHUB_TOKEN')
    expect(response.text).not.toContain('sk-zai-secret-do-not-print')
    expect(response.text).not.toContain('https://api.z.ai/api/anthropic')
    expect(response.text).not.toContain('gho_secret-do-not-print')
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

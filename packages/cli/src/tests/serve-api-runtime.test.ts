import { describe, expect, it } from 'vitest'

import { augmentServicePath, buildApiEnv } from '../serve/api-runtime.js'
import { createMockApi, emptyRepairReport, runCommand } from './helpers.js'

describe('serve api runtime env', () => {
  it('passes provider route env through to the API process', () => {
    const env = buildApiEnv({
      env: {
        HOME: '/home/operator',
        PATH: '/bin',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        OPENAI_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
        ZAI_API_KEY: 'zai-token',
        API_TIMEOUT_MS: '3000000',
        DUCTUM_CODEX_COMMAND: '/opt/codex/bin/codex',
      },
      host: '127.0.0.1',
      port: 4114,
      operatorToken: 'operator-token',
      dashboardDist: '/repo/packages/dashboard/dist',
      workflowsDir: '/repo/workflows',
      sampleSpecsDir: '/repo/packages/ductum/assets/specs/examples',
      harnessModule: '/repo/packages/harness/dist/index.js',
      mcpModule: '/repo/packages/mcp/dist/index.js',
    })

    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('anthropic-token')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic')
    expect(env.OPENAI_BASE_URL).toBe('https://api.z.ai/api/coding/paas/v4')
    expect(env.ZAI_API_KEY).toBe('zai-token')
    expect(env.API_TIMEOUT_MS).toBe('3000000')
    expect(env.DUCTUM_CODEX_COMMAND).toBe('/opt/codex/bin/codex')
  })

  it('passes explicit mock-agent env through to the API process', () => {
    const env = buildApiEnv({
      env: {
        HOME: '/home/operator',
        PATH: '/bin',
        DUCTUM_MOCK_AGENT_CALLS: '1',
        DUCTUM_MOCK_AGENT_DELAY_MS: '5',
      },
      host: '127.0.0.1',
      port: 4114,
      operatorToken: 'operator-token',
      dashboardDist: '/repo/packages/dashboard/dist',
      workflowsDir: '/repo/workflows',
      sampleSpecsDir: '/repo/packages/ductum/assets/specs/examples',
      harnessModule: '/repo/packages/harness/dist/index.js',
      mcpModule: '/repo/packages/mcp/dist/index.js',
    })

    expect(env.DUCTUM_MOCK_AGENT_CALLS).toBe('1')
    expect(env.DUCTUM_MOCK_AGENT_DELAY_MS).toBe('5')
  })

  it('prints provider harness doctor checks without token values', async () => {
    const api = createMockApi({
      getRepairReport: async () => emptyRepairReport(),
      getFactoryDoctor: async () => ({
        status: 'blocked',
        summary: { ready: 1, blocked: 1, deferred: 0 },
        liveSmoke: { enabled: false, status: 'skipped', reason: 'live smoke is opt-in and was not requested' },
        agents: [{
          agentId: 'agent-glm',
          agentName: 'glm-builder',
          assignmentRoles: ['builder'],
          providerId: 'zai',
          modelId: 'glm-5.2',
          providerModelId: 'glm-5.2',
          harnessId: 'claude-agent-sdk',
          harnessType: 'claude-agent-sdk',
          accountId: null,
          status: 'blocked',
          checks: [
            { kind: 'model_route', status: 'ready', message: 'route resolved: provider zai, provider model glm-5.2, harness adapter claude-agent-sdk' },
            { kind: 'endpoint', status: 'blocked', message: 'GLM/Z.AI route for glm-5.2 must use ANTHROPIC_BASE_URL pointing at Z.AI, not the default Anthropic/OpenAI endpoint', refs: ['ANTHROPIC_BASE_URL'] },
            { kind: 'auth', status: 'blocked', message: 'missing provider credential env for zai (ZAI_API_KEY or ANTHROPIC_AUTH_TOKEN)', refs: ['ZAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] },
          ],
        }, {
          agentId: 'agent-copilot',
          agentName: 'copilot-builder',
          assignmentRoles: ['builder'],
          providerId: 'github-copilot',
          modelId: 'github-copilot-gpt-5-4',
          providerModelId: 'gpt-5.4',
          harnessId: 'copilot-sdk',
          harnessType: 'copilot-sdk',
          accountId: null,
          status: 'ready',
          checks: [{ kind: 'auth', status: 'ready', message: 'GitHub CLI auth status is active for Copilot', refs: ['gh auth status'] }],
        }],
      }),
    })

    const result = await runCommand(['--human', 'doctor'], api)
    expect(result.text).toContain('Provider / Harness Readiness')
    expect(result.text).toContain('GLM/Z.AI route for glm-5.2 must use ANTHROPIC_BASE_URL')
    expect(result.text).toContain('GitHub CLI auth status is active for Copilot')
    expect(result.text).not.toContain('sk-zai-secret')
  })

  it('augments a sparse service PATH so setup commands can find pnpm (#243)', () => {
    const augmented = augmentServicePath('/usr/bin:/bin')
    const entries = augmented.split(':')
    expect(entries.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
    // pnpm's conventional homes are present
    expect(entries).toContain(`${process.env.HOME}/Library/pnpm`)
    expect(entries).toContain(`${process.env.HOME}/.local/bin`)
    // Homebrew (Apple Silicon + Intel) and the standard system bins are there
    expect(entries).toContain('/opt/homebrew/bin')
    expect(entries).toContain('/opt/homebrew/sbin')
    expect(entries).toContain('/usr/local/bin')
    expect(entries).toContain('/usr/sbin')
    expect(entries).toContain('/sbin')
    // The dirname of the running node binary is included so the API
    // process can find `node`/`pnpm` even when launched via `open` or a
    // launchd unit with no shell PATH.
    expect(entries).toContain(require('node:path').dirname(process.execPath))
  })

  it('preserves existing PATH entries first and dedupes when augmenting service PATH', () => {
    const customPath = '/custom/bin:/opt/homebrew/bin:/usr/bin'
    const augmented = augmentServicePath(customPath)
    const entries = augmented.split(':')
    // Existing entries come first in their original order.
    expect(entries.slice(0, 3)).toEqual(['/custom/bin', '/opt/homebrew/bin', '/usr/bin'])
    // The duplicated /opt/homebrew/bin must not appear twice.
    expect(entries.filter((entry) => entry === '/opt/homebrew/bin')).toHaveLength(1)
    // pnpm paths are still appended after the dedupe.
    expect(entries).toContain(`${process.env.HOME}/Library/pnpm`)
  })

  it('augments an undefined PATH so dispatch works when no shell PATH is set', () => {
    const augmented = augmentServicePath(undefined)
    const entries = augmented.split(':').filter((entry) => entry !== '')
    expect(entries.length).toBeGreaterThan(0)
    expect(entries).toContain('/usr/bin')
    expect(entries).toContain('/bin')
    expect(entries).toContain('/opt/homebrew/bin')
  })

  it('buildApiEnv threads the augmented PATH through to the API process', () => {
    const env = buildApiEnv({
      env: {
        HOME: '/home/operator',
        PATH: '/usr/bin:/bin',
      },
      host: '127.0.0.1',
      port: 4114,
      operatorToken: 'operator-token',
      dashboardDist: '/repo/packages/dashboard/dist',
      workflowsDir: '/repo/workflows',
      sampleSpecsDir: '/repo/packages/ductum/assets/specs/examples',
      harnessModule: '/repo/packages/harness/dist/index.js',
      mcpModule: '/repo/packages/mcp/dist/index.js',
    })
    const pathEntries = (env.PATH ?? '').split(':')
    // Original entries preserved
    expect(pathEntries).toContain('/usr/bin')
    expect(pathEntries).toContain('/bin')
    // Augmented pnpm + homebrew entries present
    expect(pathEntries).toContain('/home/operator/Library/pnpm')
    expect(pathEntries).toContain('/opt/homebrew/bin')
  })

})

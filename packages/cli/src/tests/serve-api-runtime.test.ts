import { describe, expect, it } from 'vitest'

import { buildApiEnv } from '../serve/api-runtime.js'

describe('serve api runtime env', () => {
  it('passes provider route env through to the API process', () => {
    const env = buildApiEnv({
      env: {
        HOME: '/home/operator',
        PATH: '/bin',
        ANTHROPIC_AUTH_TOKEN: 'anthropic-token',
        ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
        OPENAI_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
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
})

import { describe, expect, it } from 'vitest'

import { buildApiEnv } from '../serve/api-runtime.js'

describe('serve api runtime env', () => {
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

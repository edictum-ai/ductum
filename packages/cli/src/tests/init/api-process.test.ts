import { describe, expect, it } from 'vitest'

import { buildApiEnv } from '../../init/steps/api-process.js'

describe('init API process env', () => {
  it('passes every selected provider agent to the init API runtime', () => {
    const env = buildApiEnv({
      repoRoot: '/repo',
      projectDir: '/factory',
      port: 4777,
      operatorToken: 'operator_secret',
      env: {},
      agents: ['anthropic', 'codex', 'copilot'],
    })

    expect(env.DUCTUM_AGENTS_CONFIG).toBeDefined()
    expect(JSON.parse(env.DUCTUM_AGENTS_CONFIG ?? '{}')).toEqual({
      'claude-builder': { harness: 'claude-agent-sdk' },
      'claude-reviewer': { harness: 'claude-agent-sdk' },
      'codex-builder': { harness: 'codex-sdk' },
      'copilot-builder': { harness: 'copilot-sdk' },
    })
  })
})

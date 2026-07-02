import { describe, it, expect } from 'vitest'
import { ScopedSecretBroker } from '../scoped-secret-broker.js'
import type { Agent, AgentId } from '../types.js'

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1' as AgentId,
    name: 'builder',
    model: 'claude-sonnet-4-6',
    harness: 'claude-agent-sdk',
    capabilities: [],
    costTier: 1,
    spawnConfig: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// Resolver stub: marks resolution so the test can prove a ref was decrypted, not passed literally.
const resolver = { resolve: (ref: string) => `resolved(${ref})` }

const hostEnv = {
  PATH: '/usr/bin',
  HOME: '/home/op',
  ANTHROPIC_API_KEY: 'sk-ant-host',
  STRIPE_KEY: 'sk-stripe-LEAK',
  AWS_SECRET_ACCESS_KEY: 'aws-LEAK',
} as NodeJS.ProcessEnv

describe('ScopedSecretBroker', () => {
  it('enforce mode withholds unrelated host secrets but keeps PATH + the harness credential', () => {
    const broker = new ScopedSecretBroker({ resolver, hostEnv, mode: 'enforce' })
    const { env, droppedKeys, mode } = broker.materializeEnv(makeAgent())
    expect(mode).toBe('enforce')
    expect(env.PATH).toBe('/usr/bin')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-host') // credential preserved so Claude still authenticates
    expect(env.STRIPE_KEY).toBeUndefined() // the leak, closed
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(droppedKeys).toEqual(['AWS_SECRET_ACCESS_KEY', 'STRIPE_KEY'])
  })

  it('enforce mode resolves secret:<id> refs in spawnConfig.env, passes literals through', () => {
    const broker = new ScopedSecretBroker({ resolver, hostEnv, mode: 'enforce' })
    const agent = makeAgent({ spawnConfig: { env: { GITHUB_TOKEN: 'secret:ci-bot', PLAIN: 'literal' } } })
    const { env } = broker.materializeEnv(agent)
    expect(env.GITHUB_TOKEN).toBe('resolved(secret:ci-bot)')
    expect(env.PLAIN).toBe('literal')
    expect(env.STRIPE_KEY).toBeUndefined()
  })

  it('enforce mode preserves the Copilot GitHub token for copilot-sdk agents', () => {
    const broker = new ScopedSecretBroker({
      resolver,
      hostEnv: { ...hostEnv, COPILOT_GITHUB_TOKEN: 'gho-copilot-host' },
      mode: 'enforce',
    })
    const { env } = broker.materializeEnv(makeAgent({ harness: 'copilot-sdk' }))
    expect(env.COPILOT_GITHUB_TOKEN).toBe('gho-copilot-host')
    expect(env.STRIPE_KEY).toBeUndefined()
  })

  it('warn mode (default) preserves the full host env unchanged but reports droppedKeys', () => {
    const broker = new ScopedSecretBroker({ resolver, hostEnv })
    const { env, droppedKeys, mode } = broker.materializeEnv(makeAgent())
    expect(mode).toBe('warn')
    expect(env.STRIPE_KEY).toBe('sk-stripe-LEAK') // unchanged: no live run breaks
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-host')
    expect(droppedKeys).toContain('STRIPE_KEY')
  })

  it('warn mode leaves secret refs literal (current behavior), enforce is what resolves them', () => {
    const broker = new ScopedSecretBroker({ resolver, hostEnv })
    const agent = makeAgent({ spawnConfig: { env: { GITHUB_TOKEN: 'secret:ci-bot' } } })
    const { env } = broker.materializeEnv(agent)
    expect(env.GITHUB_TOKEN).toBe('secret:ci-bot')
  })

  it('an unknown harness still gets the base allowlist (PATH/HOME), no host secrets', () => {
    const broker = new ScopedSecretBroker({ resolver, hostEnv, mode: 'enforce' })
    const { env } = broker.materializeEnv(makeAgent({ harness: 'vercel-ai' }))
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/op')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined() // not a declared credential for this harness
    expect(env.STRIPE_KEY).toBeUndefined()
  })

  it('enforce keeps network-egress vars (proxy + custom CA) so the agent can still reach the API', () => {
    const netEnv = { PATH: '/usr/bin', HTTPS_PROXY: 'http://proxy:8080', NODE_EXTRA_CA_CERTS: '/etc/ca.pem', SECRET_X: 'leak' } as NodeJS.ProcessEnv
    const broker = new ScopedSecretBroker({ resolver, hostEnv: netEnv, mode: 'enforce' })
    const { env } = broker.materializeEnv(makeAgent())
    expect(env.HTTPS_PROXY).toBe('http://proxy:8080')
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ca.pem')
    expect(env.SECRET_X).toBeUndefined()
  })

  it('threads run/agent context to the resolver so each access can be attributed (P1 access log)', () => {
    const calls: Array<{ ref: string; context: unknown }> = []
    const contextResolver = {
      resolve: (ref: string, context?: unknown) => {
        calls.push({ ref, context })
        return `resolved(${ref})`
      },
    }
    const broker = new ScopedSecretBroker({ resolver: contextResolver, hostEnv, mode: 'enforce' })
    const agent = makeAgent({
      spawnConfig: { env: { GITHUB_TOKEN: 'secret:ci-bot', API_KEY: 'secret:openai' } },
    })
    broker.materializeEnv(agent, { runId: 'run-42' as never, agentId: agent.id })

    expect(calls).toEqual([
      { ref: 'secret:ci-bot', context: { runId: 'run-42', agentId: agent.id } },
      { ref: 'secret:openai', context: { runId: 'run-42', agentId: agent.id } },
    ])
  })

  it('propagates resolver failures (missing/malformed refs) so the dispatcher fails the run, not silently drops', () => {
    const failingResolver = {
      resolve: (ref: string) => {
        throw new Error(`Secret not found for reference: ${ref}`)
      },
    }
    const broker = new ScopedSecretBroker({ resolver: failingResolver, hostEnv, mode: 'enforce' })
    const agent = makeAgent({ spawnConfig: { env: { TOKEN: 'secret:missing' } } })
    expect(() => broker.materializeEnv(agent)).toThrow(/Secret not found for reference: secret:missing/)
  })
})

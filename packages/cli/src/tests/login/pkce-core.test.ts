import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ANTHROPIC_OAUTH_REDIRECT_URI, AuthPkceError, generatePKCE, loginAnthropicWithPkce } from '../../login/pkce-core.js'

const servers: Array<{ close: () => void }> = []
const TEST_PORT = 53720

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

describe('Anthropic PKCE core', () => {
  it('uses the Claude Code registered redirect URI by default', () => {
    expect(ANTHROPIC_OAUTH_REDIRECT_URI).toBe('http://localhost:53692/callback')
  })

  it('listens on 127.0.0.1 while advertising the Claude Code redirect URI by default', async () => {
    let listenedPort = 0
    let listenedHost = ''
    let authUrl = ''
    const server = {
      address: () => ({ port: listenedPort }),
      close: () => undefined,
      listen: (port: number, host: string, callback: () => void) => {
        listenedPort = port
        listenedHost = host
        callback()
        return server
      },
      once: () => server,
    }

    await expect(loginAnthropicWithPkce({
      createServer: (() => server) as unknown as typeof createServer,
      generatePKCE: async () => ({ verifier: validVerifier('0'), challenge: 'challenge-0', state: 'state-0' }),
      onAuth: (url) => {
        authUrl = url
      },
      timeoutMs: 1,
    })).rejects.toMatchObject({ code: 'auth_pkce_callback_timeout' })

    expect(listenedPort).toBe(53692)
    expect(listenedHost).toBe('127.0.0.1')
    expect(new URL(authUrl).searchParams.get('redirect_uri')).toBe(ANTHROPIC_OAUTH_REDIRECT_URI)
  })

  it('generates RFC 7636 verifier and challenge material with fresh state', async () => {
    const first = await generatePKCE()
    const second = await generatePKCE()

    expect(first.verifier.length).toBeGreaterThanOrEqual(43)
    expect(first.verifier.length).toBeLessThanOrEqual(128)
    expect(first.challenge).toBe(base64url(createHash('sha256').update(first.verifier).digest()))
    expect(first.state.length).toBeGreaterThanOrEqual(43)
    expect(first.state).not.toBe(first.verifier)
    expect(second.verifier).not.toBe(first.verifier)
    expect(second.state).not.toBe(first.state)
  })

  it('opens only the PKCE auth URL and exchanges the exact redirect URI', async () => {
    const verifier = validVerifier('a')
    const challenge = base64url(createHash('sha256').update(verifier).digest())
    let authUrl = ''
    let tokenBody: Record<string, unknown> = {}

    const credentials = await loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier, challenge, state: 'state-a' }),
      port: TEST_PORT,
      openBrowser: async (url) => {
        authUrl = url
        await completeCallback(url, 'code-a', 'state-a')
      },
      fetch: async (_url, init) => {
        tokenBody = JSON.parse(String(init?.body))
        return jsonResponse({ access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 3600 })
      },
    })

    const parsed = new URL(authUrl)
    const redirectUri = parsed.searchParams.get('redirect_uri')
    expect(authUrl).not.toContain(verifier)
    expect(parsed.searchParams.get('code_challenge')).toBe(challenge)
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(redirectUri).toBe(`http://localhost:${TEST_PORT}/callback`)
    expect(tokenBody).toMatchObject({ redirect_uri: redirectUri, code_verifier: verifier, state: 'state-a' })
    expect(credentials.access).toBe('access-a')
  })

  it('rejects state mismatches without exchanging a token', async () => {
    const fetchFn = vi.fn<typeof fetch>()

    await expect(loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier: validVerifier('b'), challenge: 'challenge-b', state: 'state-b' }),
      port: TEST_PORT + 1,
      openBrowser: async (url) => {
        await completeCallback(url, 'code-b', 'wrong-state', 400)
      },
      fetch: fetchFn,
    })).rejects.toMatchObject({ code: 'auth_anthropic_failed' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('validates the callback URL by exact match', async () => {
    let sawWrongHost = false
    await loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier: validVerifier('c'), challenge: 'challenge-c', state: 'state-c' }),
      port: TEST_PORT + 2,
      openBrowser: async (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri') ?? '')
        const wrongHost = new URL(redirect)
        wrongHost.hostname = '127.0.0.1'
        const wrong = await fetch(wrongHost)
        sawWrongHost = wrong.status === 404
        await completeCallback(url, 'code-c', 'state-c')
      },
      fetch: async () => jsonResponse({ access_token: 'access-c', refresh_token: 'refresh-c', expires_in: 3600 }),
    })

    expect(sawWrongHost).toBe(true)
  })

  it('times out the callback server and maps port collisions', async () => {
    await expect(loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier: validVerifier('d'), challenge: 'challenge-d', state: 'state-d' }),
      port: TEST_PORT + 3,
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: 'auth_pkce_callback_timeout' })

    const held = await listenOnLocalhost()
    await expect(loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier: validVerifier('e'), challenge: 'challenge-e', state: 'state-e' }),
      port: held.port,
    })).rejects.toMatchObject({ code: 'auth_pkce_callback_port_in_use' })
  })

  it('refuses any callback bind host other than 127.0.0.1', async () => {
    await expect(loginAnthropicWithPkce({
      generatePKCE: async () => ({ verifier: validVerifier('f'), challenge: 'challenge-f', state: 'state-f' }),
      host: '0.0.0.0',
    })).rejects.toMatchObject({ code: 'auth_pkce_callback_host_invalid' })
  })
})

async function completeCallback(authUrl: string, code: string, state: string, expectedStatus = 200): Promise<void> {
  const redirect = new URL(new URL(authUrl).searchParams.get('redirect_uri') ?? '')
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', state)
  const response = await fetch(redirect)
  expect(response.status).toBe(expectedStatus)
}

async function listenOnLocalhost(): Promise<{ port: number }> {
  const server = createServer((_req, res) => res.end('held'))
  servers.push(server)
  return await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ port: typeof address === 'object' && address != null ? address.port : 0 })
    })
  })
}

function validVerifier(suffix: string): string {
  return `${'v'.repeat(42)}${suffix}`
}

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

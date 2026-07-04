import {
  createFixture,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  seedBase,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - browser session logout', () => {
  it('clears the browser session cookie', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const reconnect = await requestJson(fixture.app, '/api/internal/session/reconnect', {
      method: 'POST',
      headers: sameOriginHeaders(),
    })
    const cookie = cookiePair(reconnect.response.headers.get('set-cookie') ?? '')

    const beforeLogout = await requestJson(fixture.app, '/api/factory', { headers: { cookie } })
    expect(beforeLogout.response.status).toBe(200)

    const response = await requestJson(fixture.app, '/api/internal/session/logout', {
      method: 'POST',
      headers: { ...sameOriginHeaders(), cookie },
    })

    expect(response.response.status).toBe(200)
    expect(response.json).toEqual({ ok: true })
    const clearCookie = response.response.headers.get('set-cookie') ?? ''
    expect(clearCookie).toContain('ductum_operator_token=')
    expect(clearCookie).toContain('Max-Age=0')
    expect(clearCookie).toContain('HttpOnly')

    const afterLogout = await requestJson(fixture.app, '/api/factory', { headers: { cookie } })
    expect(afterLogout.response.status).toBe(401)
  })

  it('refuses logout from a non-loopback request host', async () => {
    await expectForgedLogoutRejected({ host: 'factory.evil.test', origin: 'http://factory.evil.test' })
  })

  it('refuses logout from a cross-origin browser request', async () => {
    await expectForgedLogoutRejected({ host: '127.0.0.1:4100', origin: 'https://factory.evil.test' })
  })

  it('refuses logout when same-origin browser headers are absent', async () => {
    await expectForgedLogoutRejected({ host: '127.0.0.1:4100' })
  })

  it('refuses logout when the Host header is missing or empty', async () => {
    // The Origin must be one the allowlist would accept on its own
    // (dashboard port 5176 is in the default allowlist). Pairing an
    // empty Host with an allowlisted Origin isolates the regression
    // guard: if isLoopbackHost stops failing closed on '', the host
    // check passes and the Origin check also passes, so the logout
    // would incorrectly proceed and the test would fail.
    await expectForgedLogoutRejected({ host: '', origin: 'http://127.0.0.1:5176' })
  })
})

async function expectForgedLogoutRejected(headers: Record<string, string>): Promise<void> {
  const previousHost = process.env.DUCTUM_HOST
  const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
  process.env.DUCTUM_HOST = '127.0.0.1'
  delete process.env.DUCTUM_PUBLIC_BASE_URL
  try {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const reconnect = await requestJson(fixture.app, '/api/internal/session/reconnect', {
      method: 'POST',
      headers: sameOriginHeaders(),
    })
    const cookie = cookiePair(reconnect.response.headers.get('set-cookie') ?? '')

    const response = await requestJson(fixture.app, '/api/internal/session/logout', {
      method: 'POST',
      headers: { ...headers, cookie },
    })

    expect(response.response.status).toBe(403)
    expect(response.json).toMatchObject({ ok: false })
    // The session must remain valid after a forged logout attempt.
    const stillAuthed = await requestJson(fixture.app, '/api/factory', { headers: { cookie } })
    expect(stillAuthed.response.status).toBe(200)
  } finally {
    restoreEnv('DUCTUM_HOST', previousHost)
    restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
  }
}

function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0] ?? ''
}

function sameOriginHeaders(): Record<string, string> {
  return { host: '127.0.0.1:4100', origin: 'http://127.0.0.1:4100' }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

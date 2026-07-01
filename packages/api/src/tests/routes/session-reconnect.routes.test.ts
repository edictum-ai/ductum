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

describe('API routes - browser session reconnect', () => {
  it('sets a scoped HttpOnly cookie without returning the operator token', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', { method: 'POST' })

      expect(response.response.status).toBe(200)
      expect(response.json).toEqual({ ok: true })
      expect(response.text).not.toContain('operator-secret')
      const cookie = response.response.headers.get('set-cookie') ?? ''
      expect(cookie).toContain('ductum_operator_token=operator-secret')
      expect(cookie).toContain('Path=/api')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Strict')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('refuses reconnect when local browser reconnect is disabled', async () => {
    const previous = process.env.DUCTUM_DISABLE_LOCAL_SESSION_RECONNECT
    process.env.DUCTUM_DISABLE_LOCAL_SESSION_RECONNECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', { method: 'POST' })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_DISABLE_LOCAL_SESSION_RECONNECT', previous)
    }
  })

  it('refuses reconnect when the API binds publicly', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '0.0.0.0'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', { method: 'POST' })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('refuses local reconnect from a non-loopback request host', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: { host: 'factory.evil.test' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
      expect(response.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('refuses local reconnect from a cross-origin browser request', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: { host: '127.0.0.1:4100', origin: 'https://factory.evil.test' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
      expect(response.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('refuses local reconnect from a different loopback origin port', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: { host: '127.0.0.1:4100', origin: 'http://127.0.0.1:9999' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.response.headers.get('set-cookie')).toBeNull()
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('allows local reconnect from a same-origin loopback browser request', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousPublicBase = process.env.DUCTUM_PUBLIC_BASE_URL
    process.env.DUCTUM_HOST = '127.0.0.1'
    delete process.env.DUCTUM_PUBLIC_BASE_URL
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })
      seedBase(fixture)

      const response = await requestJson(fixture.app, '/api/internal/session/reconnect', {
        method: 'POST',
        headers: { host: '127.0.0.1:4100', origin: 'http://127.0.0.1:4100' },
      })

      expect(response.response.status).toBe(200)
      expect(response.response.headers.get('set-cookie')).toContain('ductum_operator_token=operator-secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_PUBLIC_BASE_URL', previousPublicBase)
    }
  })

  it('refuses operator-token-detect from a non-loopback request host', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })

      const response = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: { host: 'factory.evil.test' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('clears the browser session cookie', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })

    const response = await requestJson(fixture.app, '/api/internal/session/logout', { method: 'POST' })

    expect(response.response.status).toBe(200)
    expect(response.json).toEqual({ ok: true })
    const cookie = response.response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('ductum_operator_token=')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

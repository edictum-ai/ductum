import {
  createFixture,
  describe,
  expect,
  it,
  registerRouteTestCleanup,
  requestJson,
  type TestFixture,
} from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - operator token detect', () => {
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

  it('refuses operator-token-detect from a cross-origin browser request', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })

      const response = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: { host: '127.0.0.1:4100', origin: 'https://factory.evil.test' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('refuses operator-token-detect when same-origin browser headers are absent', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })

      const response = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: { host: '127.0.0.1:4100' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })

  it('refuses operator-token-detect when Host header is missing or empty', async () => {
    const previousHost = process.env.DUCTUM_HOST
    const previousOptIn = process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT
    process.env.DUCTUM_HOST = '127.0.0.1'
    process.env.DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT = '1'
    try {
      fixture = await createFixture({ operatorToken: 'operator-secret' })

      // Empty Host header must fail closed even when the Origin pretends to
      // be a trusted loopback — the host check is defense-in-depth against
      // forged or stripped Host headers.
      const response = await requestJson(fixture.app, '/api/internal/operator-token-detect', {
        headers: { host: '', origin: 'http://127.0.0.1:4100' },
      })

      expect(response.response.status).toBe(403)
      expect(response.json).toMatchObject({ ok: false })
      expect(response.text).not.toContain('operator-secret')
    } finally {
      restoreEnv('DUCTUM_HOST', previousHost)
      restoreEnv('DUCTUM_ENABLE_OPERATOR_TOKEN_DETECT', previousOptIn)
    }
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value == null) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

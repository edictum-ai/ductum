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
import { HandoffTokenStore } from '../../lib/handoff-tokens.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - welcome handoff', () => {
  it('requires operator-token auth before minting a handoff token', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)

    const response = await requestJson(fixture.app, '/api/welcome/handoff', { method: 'POST' })

    expect(response.response.status).toBe(401)
    expect(response.text).not.toContain('operator-secret')
  })

  it('mints a short-lived handoff token without exposing the operator token', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)

    const response = await requestJson(fixture.app, '/api/welcome/handoff', {
      method: 'POST',
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })

    expect(response.response.status).toBe(200)
    const payload = response.json as {
      kind: string
      data: { handoffToken: string; ttlSeconds: number; welcomePath: string }
    }
    expect(payload.kind).toBe('welcome.handoff_created')
    expect(payload.data.ttlSeconds).toBe(60)
    expect(payload.data.welcomePath).toBe('/welcome')
    expect(payload.data.handoffToken).not.toBe('operator-secret')
    expect(response.text).not.toContain('operator-secret')

    const direct = await requestJson(
      fixture.app,
      `/api/factory?ductum_operator_token=${encodeURIComponent(payload.data.handoffToken)}`,
    )
    expect(direct.response.status).toBe(401)
  })

  it('serves the bundled welcome sample spec through the operator-protected API', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)

    const response = await requestJson(fixture.app, '/api/welcome/sample-spec', {
      method: 'GET',
      headers: { 'x-ductum-operator-token': 'operator-secret' },
    })

    expect(response.response.status).toBe(200)
    const payload = response.json as {
      kind: string
      data: { source: { path: string }; spec: { name: string; document: string }; tasks: Array<{ name: string; prompt: string }> }
    }
    expect(payload.kind).toBe('welcome.sample_spec')
    expect(payload.data.source.path).toContain('assets/specs/examples/hello-readme')
    expect(payload.data.spec.name).toBe('hello-readme')
    expect(payload.data.spec.document).toContain('Minimal bootstrap proof spec')
    expect(payload.data.tasks[0]?.name).toBe('append-readme-line')
    expect(payload.data.tasks[0]?.prompt).toContain('Bootstrap proof: hello from Ductum.')
  })

  it('exchanges once into a scoped httpOnly cookie used server-side only', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const minted = await mintHandoff()

    const exchange = await requestJson(fixture.app, '/api/internal/welcome/exchange', {
      method: 'POST',
      body: { token: minted },
    })

    expect(exchange.response.status).toBe(200)
    expect(exchange.text).not.toContain('operator-secret')
    const cookie = exchange.response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('ductum_operator_token=operator-secret')
    expect(cookie).toContain('Path=/api')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')

    const protectedResponse = await requestJson(fixture.app, '/api/factory', {
      headers: { cookie: 'ductum_operator_token=operator-secret' },
    })
    expect(protectedResponse.response.status).toBe(200)

    const replay = await requestJson(fixture.app, '/api/internal/welcome/exchange', {
      method: 'POST',
      body: { token: minted },
    })
    expect(replay.response.status).toBe(410)
    expect(replay.response.headers.get('set-cookie')).toBeNull()
  })

  it('marks the handoff cookie secure when the request is HTTPS', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })
    seedBase(fixture)
    const minted = await mintHandoff()

    const exchange = await requestJson(fixture.app, '/api/internal/welcome/exchange', {
      method: 'POST',
      headers: { 'x-forwarded-proto': 'https' },
      body: { token: minted },
    })

    expect(exchange.response.status).toBe(200)
    const cookie = exchange.response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('rejects an unused handoff token after the 60s TTL', async () => {
    let nowMs = Date.parse('2026-05-03T12:00:00.000Z')
    fixture = await createFixture({
      operatorToken: 'operator-secret',
      now: () => new Date(nowMs),
    })
    seedBase(fixture)
    const minted = await mintHandoff()

    nowMs += 61_000
    const expired = await requestJson(fixture.app, '/api/internal/welcome/exchange', {
      method: 'POST',
      body: { token: minted },
    })

    expect(expired.response.status).toBe(410)
    expect(JSON.stringify(expired.json)).toContain('handoff_token_expired')
  })

  it('rejects a handoff token minted for a different factory', async () => {
    const handoffTokens = new HandoffTokenStore()
    const minted = handoffTokens.mint({
      factoryId: 'other-factory',
      operatorToken: 'operator-secret',
      nowMs: Date.parse('2026-05-03T12:00:00.000Z'),
    })
    fixture = await createFixture({
      operatorToken: 'operator-secret',
      handoffTokens,
      now: () => new Date('2026-05-03T12:00:01.000Z'),
    })
    seedBase(fixture)

    const mismatch = await requestJson(fixture.app, '/api/internal/welcome/exchange', {
      method: 'POST',
      body: { token: minted.token },
    })

    expect(mismatch.response.status).toBe(401)
    expect(JSON.stringify(mismatch.json)).toContain('handoff_token_factory_mismatch')
  })
})

async function mintHandoff(): Promise<string> {
  if (fixture == null) throw new Error('fixture missing')
  const response = await requestJson(fixture.app, '/api/welcome/handoff', {
    method: 'POST',
    headers: { 'x-ductum-operator-token': 'operator-secret' },
  })
  const payload = response.json as { data: { handoffToken: string } }
  return payload.data.handoffToken
}

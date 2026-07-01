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

describe('API internal auth boundary', () => {
  it('does not auth-exempt every /api/internal route by path alone', async () => {
    fixture = await createFixture({ operatorToken: 'operator-secret' })

    const response = await requestJson(fixture.app, '/api/internal/plugin-probe?session_id=session-1')

    expect(response.response.status).toBe(401)
    expect(response.text).not.toContain('operator-secret')
  })
})

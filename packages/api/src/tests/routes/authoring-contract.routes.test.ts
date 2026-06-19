import { createFixture, describe, expect, it, registerRouteTestCleanup, type TestFixture } from './shared.js'

let fixture: TestFixture | undefined
registerRouteTestCleanup(() => fixture, () => { fixture = undefined })

describe('API routes - authoring contract', () => {
  it('serves llms.txt without operator auth', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })

    const response = await fixture.app.request('/llms.txt')
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(text).toContain('Ductum Agent Authoring Contract')
    expect(text).toContain('Agents never pass run_id')
  })

  it('serves llms-full.txt without operator auth', async () => {
    fixture = await createFixture({ operatorToken: 'secret' })

    const response = await fixture.app.request('/llms-full.txt')
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/plain')
    expect(text).toContain('Ductum Full Agent Authoring Contract')
    expect(text).toContain('Operator-allowlisted ExtensionRegistry manifest loading is shipped')
  })
})

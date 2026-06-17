import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createFixture, requestJson, type TestFixture } from './helpers.js'

let fixture: TestFixture | undefined
let dashboardDir: string | undefined

afterEach(async () => {
  fixture?.close()
  fixture = undefined
  delete process.env.DUCTUM_DASHBOARD_DIST
  if (dashboardDir != null) await rm(dashboardDir, { recursive: true, force: true })
  dashboardDir = undefined
})

describe('dashboard static hosting', () => {
  it('serves the built dashboard without stealing unknown API routes', async () => {
    dashboardDir = await mkdtemp(join(tmpdir(), 'ductum-dashboard-'))
    await mkdir(join(dashboardDir, 'assets'))
    await writeFile(join(dashboardDir, 'index.html'), '<main>Ductum shell</main>', 'utf8')
    await writeFile(join(dashboardDir, 'assets', 'app.js'), 'console.log("ductum")', 'utf8')
    process.env.DUCTUM_DASHBOARD_DIST = dashboardDir

    fixture = await createFixture()

    const root = await fixture.app.request('/')
    const nested = await fixture.app.request('/settings')
    const asset = await fixture.app.request('/assets/app.js')
    const missingApi = await requestJson(fixture.app, '/api/not-real')

    expect(root.status).toBe(200)
    expect(await root.text()).toContain('Ductum shell')
    expect(root.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(root.headers.get('x-content-type-options')).toBe('nosniff')
    expect(nested.status).toBe(200)
    expect(await nested.text()).toContain('Ductum shell')
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('ductum')
    expect(asset.headers.get('content-security-policy')).toContain("object-src 'none'")
    expect(missingApi.response.status).toBe(404)
    expect(missingApi.response.headers.get('content-security-policy')).toBeNull()
    expect(missingApi.json).toEqual({ error: 'Not found' })
  })

  it('can be explicitly disabled for API-only deployments', async () => {
    process.env.DUCTUM_DASHBOARD_DIST = 'disabled'
    fixture = await createFixture()

    const spaRoute = await requestJson(fixture.app, '/settings')
    const health = await requestJson(fixture.app, '/api/health')

    expect(spaRoute.response.status).toBe(404)
    expect(spaRoute.json).toEqual({ error: 'Not found' })
    expect(health.response.status).toBe(200)
    expect(health.json).toMatchObject({ ok: true })
  })
})

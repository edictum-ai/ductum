import { serveStatic } from '@hono/node-server/serve-static'
import type { Context, Hono } from 'hono'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const DEFAULT_DASHBOARD_DIST = 'packages/dashboard/dist'

export function registerDashboardStatic(app: Hono) {
  const root = process.env.DUCTUM_DASHBOARD_DIST?.trim() || DEFAULT_DASHBOARD_DIST
  if (root === 'disabled' || !existsSync(root)) return

  const staticRoot = serveStaticRoot(root)
  const staticFiles = serveStatic({ root: staticRoot })

  app.use('*', async (c, next) => {
    if (!c.req.path.startsWith('/api/')) setDashboardSecurityHeaders(c)
    await next()
  })

  app.use('/assets/*', staticFiles)
  app.use('/favicon*', staticFiles)
  app.use('/manifest*', staticFiles)
  app.use('/robots.txt', staticFiles)

  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveStatic({ root: staticRoot, path: 'index.html' })(c, next)
  })
}

function serveStaticRoot(root: string): string {
  const absolute = resolve(root)
  const fromCwd = relative(process.cwd(), absolute)
  if (fromCwd === '') return '.'
  return fromCwd.startsWith('..') ? absolute : fromCwd
}

function setDashboardSecurityHeaders(c: Context) {
  c.header('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
  ].join('; '))
  c.header('Referrer-Policy', 'no-referrer')
  c.header('X-Content-Type-Options', 'nosniff')
}

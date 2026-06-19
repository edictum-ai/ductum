import { Hono } from 'hono'

import type { ApiDeps } from './lib/deps.js'
import { createApiContext } from './lib/deps.js'
import { clearOperatorCookie, localSessionReconnectResult, serializeOperatorCookie, shouldUseSecureCookie } from './lib/operator-session.js'
import { registerErrorHandling } from './middleware/errors.js'
import { registerOperatorAuth } from './middleware/operator-auth.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerAuthoringContractRoutes } from './routes/authoring-contract.js'
import { registerAttemptRoutes } from './routes/attempts.js'
import { registerBakeoffRoutes } from './routes/bakeoffs.js'
import { registerDecisionRoutes } from './routes/decisions.js'
import { registerConfigResourceRoutes } from './routes/config-resources.js'
import { registerEvidenceRoutes } from './routes/evidence.js'
import { registerEventRoutes } from './routes/events.js'
import { registerFactoryRoutes } from './routes/factory.js'
import { registerFactorySettingsRoutes } from './routes/factory-settings.js'
import { registerMcpRoutes } from './routes/mcp.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerRepositoryRoutes } from './routes/repositories.js'
import { registerRepairRoutes } from './routes/repair.js'
import { registerResolveRoutes } from './routes/resolve.js'
import { registerRunRoutes } from './routes/runs.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerSpecIntakeRoutes } from './routes/spec-intake.js'
import { registerSpecRoutes } from './routes/specs.js'
import { registerTaskRoutes } from './routes/tasks.js'
import { registerTaskImportRoutes } from './routes/task-imports.js'
import { registerTaskSyncRoutes } from './routes/task-sync.js'
import { registerTargetRoutes } from './routes/targets.js'
import { registerTelegramRoutes } from './routes/telegram.js'
import { registerWelcomeHandoffRoutes } from './routes/welcome-handoff.js'
import { registerDashboardStatic } from './routes/dashboard-static.js'

export function createApp(deps: ApiDeps) {
  const app = new Hono()
  const context = createApiContext(deps)

  // Public, unauthenticated probe. `operatorTokenProtected` lets the
  // CLI, dashboard, and remote agents tell whether the API requires an
  // operator token without leaking the token itself.
  app.get('/api/health', (c) => c.json({
    ok: true,
    operatorTokenProtected: context.operatorToken != null && context.operatorToken !== '',
  }))

  // Explicit opt-in local reconnect for the dashboard. /api/internal/*
  // is unauthenticated by registerOperatorAuth, so returning or setting
  // credentials requires both a loopback bind and server opt-in.
  app.get('/api/internal/operator-token-detect', (c) => {
    const result = localSessionReconnectResult(context.operatorToken, process.env)
    if (!result.ok) return c.json({ ok: false, reason: result.reason }, result.status)
    return c.json({ ok: true, token: result.operatorToken })
  })

  app.post('/api/internal/session/reconnect', (c) => {
    const result = localSessionReconnectResult(context.operatorToken, process.env)
    if (!result.ok) return c.json({ ok: false, reason: result.reason }, result.status)
    c.header('Set-Cookie', serializeOperatorCookie(result.operatorToken, shouldUseSecureCookie(c)))
    return c.json({ ok: true })
  })

  app.post('/api/internal/session/logout', (c) => {
    c.header('Set-Cookie', clearOperatorCookie(shouldUseSecureCookie(c)))
    return c.json({ ok: true })
  })

  registerAuthoringContractRoutes(app)
  registerOperatorAuth(app, context)

  registerFactoryRoutes(app, context)
  registerFactorySettingsRoutes(app, context)
  registerProjectRoutes(app, context)
  registerRepositoryRoutes(app, context)
  registerRepairRoutes(app, context)
  registerTargetRoutes(app, context)
  registerConfigResourceRoutes(app, context)
  registerAgentRoutes(app, context)
  registerAttemptRoutes(app, context)
  registerBakeoffRoutes(app, context)
  registerSpecIntakeRoutes(app, context)
  registerSpecRoutes(app, context)
  registerTaskRoutes(app, context)
  registerTaskSyncRoutes(app, context)
  registerTaskImportRoutes(app, context)
  registerSearchRoutes(app, context)
  registerDecisionRoutes(app, context)
  registerRunRoutes(app, context)
  registerEvidenceRoutes(app, context)
  registerEventRoutes(app, context)
  registerResolveRoutes(app, context)
  registerMcpRoutes(app, context)
  registerTelegramRoutes(app, context)
  registerWelcomeHandoffRoutes(app, context)
  registerDashboardStatic(app)
  registerErrorHandling(app)

  return app
}

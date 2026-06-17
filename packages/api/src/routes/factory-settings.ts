import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { buildApiFactorySettings } from '../lib/factory-settings.js'
import { publicOutput } from '../lib/public-output.js'
import { registerFactoryCatalogRoutes } from './factory-catalogs.js'
import { registerFactoryRuntimeRoutes } from './factory-runtime.js'
import { registerFactorySecretRoutes } from './factory-secrets.js'

export function registerFactorySettingsRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory-settings', (c) => c.json(publicOutput(buildApiFactorySettings(context))))
  registerFactoryRuntimeRoutes(app, context)
  registerFactoryCatalogRoutes(app, context)
  registerFactorySecretRoutes(app, context)
}

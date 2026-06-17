import type { FactorySettingsCatalogs } from '@ductum/core'
import type { Hono } from 'hono'

import type { ApiContext } from '../lib/deps.js'
import { NotImplementedError } from '../lib/errors.js'
import { publicOutput } from '../lib/public-output.js'

type CatalogName = 'models' | 'harnesses' | 'workflows' | 'sandboxProfiles' | 'notificationChannels'

const CATALOGS: Array<{ path: string; name: CatalogName }> = [
  { path: '/api/factory/models', name: 'models' },
  { path: '/api/factory/harnesses', name: 'harnesses' },
  { path: '/api/factory/workflows', name: 'workflows' },
  { path: '/api/factory/sandboxes', name: 'sandboxProfiles' },
  { path: '/api/factory/notification-channels', name: 'notificationChannels' },
]

export function registerFactoryCatalogRoutes(app: Hono, context: ApiContext) {
  app.get('/api/factory/providers', (c) => c.json(publicOutput(context.repos.catalogs.listProviders())))
  app.post('/api/factory/providers', () => rejectP1CatalogWrite('Provider'))
  app.patch('/api/factory/providers/:id', () => rejectP1CatalogWrite('Provider'))

  for (const catalog of CATALOGS) {
    app.get(catalog.path, (c) => c.json(publicOutput(listCatalog(context, catalog.name))))
    app.post(catalog.path, () => rejectP1CatalogWrite('Factory catalog'))
    app.patch(`${catalog.path}/:id`, () => rejectP1CatalogWrite('Factory catalog'))
  }
}

function listCatalog(context: ApiContext, name: CatalogName): FactorySettingsCatalogs[CatalogName] {
  switch (name) {
    case 'models':
      return context.repos.catalogs.listModels()
    case 'harnesses':
      return context.repos.catalogs.listHarnesses()
    case 'workflows':
      return context.repos.catalogs.listWorkflows()
    case 'sandboxProfiles':
      return context.repos.catalogs.listSandboxProfiles()
    case 'notificationChannels':
      return context.repos.catalogs.listNotificationChannels()
  }
}

function rejectP1CatalogWrite(label: string): never {
  throw new NotImplementedError(`${label} writes are not implemented in P1 Factory Settings foundation`)
}

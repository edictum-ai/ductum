import { buildFactorySettingsCatalogs } from '../factory-settings.js'
import type {
  FactorySettingsHarness,
  FactorySettingsModel,
  FactorySettingsNotificationChannel,
  FactorySettingsProvider,
  FactorySettingsSandboxProfile,
  FactorySettingsWorkflow,
} from '../factory-settings-types.js'
import type { FactoryCatalogRepo } from './factory-settings-interfaces.js'
import type { ConfigResourceRepo } from './interfaces.js'

export class ConfigBackedFactoryCatalogRepo implements FactoryCatalogRepo {
  constructor(private readonly configResources: ConfigResourceRepo) {}

  listProviders(): FactorySettingsProvider[] {
    return this.catalogs().providers
  }

  listModels(): FactorySettingsModel[] {
    return this.catalogs().models
  }

  listHarnesses(): FactorySettingsHarness[] {
    return this.catalogs().harnesses
  }

  listWorkflows(): FactorySettingsWorkflow[] {
    return this.catalogs().workflows
  }

  listSandboxProfiles(): FactorySettingsSandboxProfile[] {
    return this.catalogs().sandboxProfiles
  }

  listNotificationChannels(): FactorySettingsNotificationChannel[] {
    return this.catalogs().notificationChannels
  }

  private catalogs() {
    return buildFactorySettingsCatalogs({
      configResources: this.configResources.list(),
      agents: [],
    })
  }
}

import { Command } from 'commander'
import type { FactorySettingsCatalogs } from '@ductum/core'

import { formatSummaryRows } from '../format.js'
import { createAction } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'

export function registerFactorySettingsCommands(program: Command, deps: CliProgramDeps) {
  const factory = program.command('factory').description('Manage Factory Settings')
  factory
    .command('settings')
    .description('Show Factory Settings catalogs')
    .action(createAction(deps, async (ctx) => {
      const settings = await ctx.api.getFactorySettings()
      ctx.write(settings, formatFactorySettings(settings))
    }))
}

function formatFactorySettings(settings: FactorySettingsCatalogs): string {
  return formatSummaryRows({
    Providers: settings.providers.length,
    Models: settings.models.length,
    Harnesses: settings.harnesses.length,
    Workflows: settings.workflows.length,
    Agents: settings.agents.length,
    Sandboxes: settings.sandboxProfiles.length,
    Notifications: settings.notificationChannels.length,
    Budgets: settings.budgets.name,
    Runtime: settings.runtimePreferences.name,
  })
}

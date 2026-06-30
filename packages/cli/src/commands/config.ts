import { existsSync } from 'node:fs'
import { Command } from 'commander'

import { createAction, readPromptInput } from '../runtime.js'
import type { CliProgramDeps } from '../runtime.js'
import {
  readUserConfig,
  setUserApiUrl,
  setUserOperatorToken,
  userConfigPath,
  userOperatorTokenPath,
} from '../user-config.js'

interface TokenSetOptions {
  stdin?: boolean
}

export function registerConfigCommands(program: Command, deps: CliProgramDeps) {
  const config = program
    .command('config')
    .description('Manage local CLI defaults')

  config
    .command('show')
    .description('Show local CLI defaults without revealing secrets')
    .action(createAction(deps, async (ctx) => {
      const configPath = userConfigPath(ctx.env)
      const tokenPath = userOperatorTokenPath(ctx.env)
      const userConfig = readUserConfig(ctx.env)
      const payload = {
        apiUrl: userConfig.apiUrl ?? null,
        authConfigured: existsSync(tokenPath),
        configPath,
        authPath: tokenPath,
      }
      ctx.write(payload, [
        `apiUrl: ${payload.apiUrl ?? '(default http://localhost:4100)'}`,
        `access: ${payload.authConfigured ? 'configured' : 'not configured'}`,
        `configPath: ${configPath}`,
        `authPath: ${tokenPath}`,
      ].join('\n'))
    }))

  const token = config
    .command('token')
    .description('Manage the stored operator token')

  token
    .command('set [token]')
    .option('--stdin', 'Read the operator token from stdin')
    .description('Store the operator token for future CLI commands')
    .action(createAction(deps, async (ctx, tokenValue: string | undefined, options: TokenSetOptions = {}) => {
      const value = options.stdin === true ? await readPromptInput(ctx.stdin) : tokenValue
      if (value == null || value.trim() === '') {
        throw new Error('Usage: ductum config token set <token> or ductum config token set --stdin')
      }
      const path = setUserOperatorToken(value, ctx.env)
      ctx.write({ ok: true, tokenPath: path }, `Stored access file: ${path}`)
    }))

  const apiUrl = config
    .command('api-url')
    .description('Manage the default API URL')

  apiUrl
    .command('set <url>')
    .description('Store the default API URL for future CLI commands')
    .action(createAction(deps, async (ctx, url: string) => {
      const path = setUserApiUrl(url, ctx.env)
      const stored = readUserConfig(ctx.env).apiUrl
      ctx.write({ ok: true, apiUrl: stored, configPath: path }, `Stored API URL: ${stored}`)
    }))
}

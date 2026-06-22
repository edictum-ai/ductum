import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { OPERATOR_ACTION_MANIFEST } from '@/lib/operator-action-manifest'

const SOURCE_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..')
const API_RUNS_ROUTE = path.resolve(SOURCE_ROOT, '../../api/src/routes/runs.ts')
const CLI_COMMANDS_ROOT = path.resolve(SOURCE_ROOT, '../../cli/src/commands')

const DASHBOARD_CONTROL_FILES: Record<string, string> = {
  RunControls: path.resolve(SOURCE_ROOT, 'pages/run-detail/run-controls.tsx'),
  RunRecoveryControls: path.resolve(SOURCE_ROOT, 'pages/run-detail/run-recovery-controls.tsx'),
  RunRedirectControl: path.resolve(SOURCE_ROOT, 'pages/run-detail/run-redirect-control.tsx'),
}

describe('operator action conformance', () => {
  it('every manifest API endpoint exists in the Hono run routes', () => {
    const routeSource = readFileSync(API_RUNS_ROUTE, 'utf8')
    const missing = OPERATOR_ACTION_MANIFEST
      .map((action) => ({ id: action.id, needle: honoRouteNeedle(action.apiEndpoint) }))
      .filter(({ needle }) => !routeSource.includes(needle))

    expect(missing).toEqual([])
  })

  it('every manifest CLI command resolves to a registered command name', () => {
    const cliSource = readCliCommandSource()
    const missing = OPERATOR_ACTION_MANIFEST
      .filter((action) => action.cliCommand != null)
      .map((action) => ({ id: action.id, commandName: cliCommandName(action.cliCommand!) }))
      .filter(({ commandName }) => !new RegExp(`\\.command\\('${escapeRegExp(commandName)}(?:\\s|')`).test(cliSource))

    expect(missing).toEqual([])
  })

  it('every dashboard control points at a source file that handles the action id', () => {
    const missing = OPERATOR_ACTION_MANIFEST
      .filter((action) => action.dashboardControl != null)
      .map((action) => {
        const [componentName, controlId] = action.dashboardControl!.split('.')
        const file = componentName == null ? undefined : DASHBOARD_CONTROL_FILES[componentName]
        const source = file == null ? null : readFileSync(file, 'utf8')
        return { id: action.id, componentName, controlId, source }
      })
      .filter(({ id, componentName, controlId, source }) => {
        if (source == null || componentName == null || controlId == null) return true
        if (componentName === 'RunRedirectControl') return !source.includes(`run-control-${controlId}`)
        return !source.includes(`'${id}'`)
      })
      .map(({ id, componentName, controlId }) => ({ id, dashboardControl: `${componentName}.${controlId}` }))

    expect(missing).toEqual([])
  })
})

function honoRouteNeedle(endpoint: string): string {
  const [method, route] = endpoint.split(' ')
  if (method == null || route == null) throw new Error(`Invalid API endpoint: ${endpoint}`)
  return `app.${method.toLowerCase()}('${route}'`
}

function cliCommandName(command: string): string {
  const parts = command.split(/\s+/)
  if (parts[0] !== 'ductum') throw new Error(`Invalid CLI command: ${command}`)
  return parts[1] === 'attempt' ? parts[2]! : parts[1]!
}

function readCliCommandSource(): string {
  return listFiles(CLI_COMMANDS_ROOT)
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
}

function listFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const info = statSync(full)
    if (info.isDirectory()) files.push(...listFiles(full))
    if (info.isFile() && full.endsWith('.ts')) files.push(full)
  }
  return files
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

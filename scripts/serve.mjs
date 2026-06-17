#!/usr/bin/env node

/**
 * pnpm serve — repo-local command to start everything.
 *
 * DB-only startup. The Factory must already exist in SQLite (created by
 * `ductum init`); this script never reads or seeds from a YAML config file.
 * It loads runtime values from the Factory DB exactly the way `ductum start`
 * does, then starts the API + dashboard.
 *
 * Usage: pnpm serve
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import {
  ensureOperatorToken,
  ignoreBrokenPipe,
  isUsableOperatorToken,
  loadLocalEnv,
  waitForApi,
} from './serve-helpers.mjs'
import { ensureNativeDependencies } from './ensure-native-deps.mjs'

ignoreBrokenPipe(process.stdout)
ignoreBrokenPipe(process.stderr)

loadLocalEnv()

// --- Parse args ---
const cliArgs = process.argv.slice(2)
if (cliArgs[0] === '--') cliArgs.shift()
const args = parseArgs({
  args: cliArgs,
  options: {
    db: { type: 'string', default: process.env.DUCTUM_DB_PATH ?? './ductum.db' },
    host: { type: 'string' },
    'dashboard-host': { type: 'string', default: process.env.DUCTUM_DASHBOARD_HOST ?? '127.0.0.1' },
    reset: { type: 'boolean', default: false },
    'no-dashboard': { type: 'boolean', default: false },
    'api-watch': { type: 'boolean', default: false },
    'no-dispatch': { type: 'boolean', default: false },
    'operator-token': { type: 'string' },
  },
  allowPositionals: false,
  strict: false,
})

const dbPath = resolve(args.values.db)
const factoryDir = dirname(dbPath)
const skipDashboard = args.values['no-dashboard']
const dashboardHost = args.values['dashboard-host']
const apiWatch = args.values['api-watch']

try {
  ensureNativeDependencies()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

if (args.values.reset) {
  const { resetDb } = await import('../packages/core/dist/index.js')
  resetDb(dbPath)
}

// --- Require an initialized Factory DB (no YAML, no seeding) ---
const { inspectFactoryDatabase } = await import('../packages/core/dist/index.js')
const inspection = inspectFactoryDatabase(dbPath)
if (inspection.state !== 'has_factory') {
  const reason = inspection.state === 'no_schema'
    ? `${dbPath} is not a Ductum Factory database`
    : inspection.state === 'missing'
      ? `${dbPath} does not exist`
      : `${dbPath} has no Factory record`
  console.error(`No Factory setup found for pnpm serve: ${reason}.`)
  console.error('Create one first with the CLI init path:')
  console.error(`  node packages/cli/dist/index.js init --dir ${factoryDir}`)
  console.error('  (or: pnpm ductum init)')
  process.exit(1)
}

// --- Load runtime values from the Factory DB (same path as ductum start) ---
const { loadPersistedServeConfig } = await import('../packages/cli/dist/serve/db-config.js')
const { buildApiEnv, buildApiProcessArgs, resolveApiRuntimeLayout } = await import('../packages/cli/dist/serve/api-runtime.js')
const config = loadPersistedServeConfig(dbPath, factoryDir)

const apiHost = args.values.host ?? process.env.DUCTUM_HOST ?? config.apiBindHost ?? '127.0.0.1'
const apiPort = Number(process.env.DUCTUM_PORT ?? config.apiPort ?? 4100)
const dashPort = Number(process.env.DUCTUM_DASHBOARD_PORT ?? 5176)
const dispatchEnabled = !args.values['no-dispatch'] && config.dispatcherEnabled !== false
const API = `http://localhost:${apiPort}`
const DASHBOARD_URL = config.dashboardUrl ?? (skipDashboard ? API : `http://localhost:${dashPort}`)

let operatorTokenResult
try {
  operatorTokenResult = await ensureOperatorToken({
    requestedToken: args.values['operator-token'],
    envPath: resolve('.env.local'),
  })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
const operatorToken = isUsableOperatorToken(operatorTokenResult.token) ? operatorTokenResult.token : ''

const layout = resolveApiRuntimeLayout({ repoRoot: resolve('.'), requireApiEntry: true })

// --- Start API server ---
console.log(`\n  Starting Ductum...\n`)
if (operatorTokenResult.saved) {
  const label = operatorTokenResult.action === 'chosen' ? 'saved' : 'generated and saved'
  console.log(`  Operator token ${label} in ${operatorTokenResult.envPath}`)
  console.log('  CLI commands will read it from .env.local; the token is not printed.')
}

if (await waitForApi(API, 800)) {
  console.error(`  API port ${apiPort} is already serving /api/health.`)
  console.error('  Stop the existing Ductum server before running pnpm serve so startup cannot bind the wrong port.')
  process.exit(1)
}

const apiArgs = buildApiProcessArgs({
  apiEntry: layout.apiEntry,
  host: apiHost,
  port: apiPort,
  dbPath,
  dispatch: dispatchEnabled,
})

const apiEnv = buildApiEnv({
  env: process.env,
  host: apiHost,
  port: apiPort,
  operatorToken,
  factoryDataDir: factoryDir,
  dashboardDist: layout.dashboardDist,
  workflowsDir: layout.workflowsDir,
  sampleSpecsDir: layout.sampleSpecsDir,
  harnessModule: layout.harnessModule,
  mcpModule: layout.mcpModule,
  repoPathMap: config.repoPathMap,
  agentsConfig: config.agentsConfig,
  worktreeConfig: config.worktreeConfig,
  heartbeatTimeoutSeconds: config.heartbeatTimeoutSeconds,
  heartbeatIntervalMs: config.heartbeatIntervalMs,
  mergeConfig: config.mergeConfig,
  costBudget: config.costBudget,
  publicBaseUrl: config.publicBaseUrl,
  dashboardUrl: DASHBOARD_URL,
  workflowProfiles: config.workflowProfiles,
  observerMode: config.observerMode,
})

const apiProc = spawn(
  'node',
  [...(apiWatch ? ['--watch'] : []), ...apiArgs],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...apiEnv } },
)

apiProc.stdout.on('data', (d) => {
  const msg = d.toString().trim()
  if (msg) console.log(`  [api] ${msg}`)
})
ignoreBrokenPipe(apiProc.stdout)

apiProc.stderr.on('data', (d) => {
  const msg = d.toString().trim()
  if (msg) console.error(`  [api] ${msg}`)
})
ignoreBrokenPipe(apiProc.stderr)

let apiExited = false
apiProc.once('exit', () => {
  apiExited = true
})

process.on('SIGINT', () => {
  apiProc.kill()
  if (dashProc) dashProc.kill()
  process.exit(0)
})

process.on('SIGTERM', () => {
  apiProc.kill()
  if (dashProc) dashProc.kill()
  process.exit(0)
})

const ready = await waitForApi(API)
if (!ready) {
  console.error('  API failed to start within 10s')
  apiProc.kill()
  process.exit(1)
}
if (apiExited) {
  console.error('  API process exited during startup')
  process.exit(1)
}
console.log(`  API running on :${apiPort}`)

let dashProc = null
const dashboardDist = resolve(process.env.DUCTUM_DASHBOARD_DIST ?? layout.dashboardDist)
const staticDashboardAvailable = existsSync(resolve(dashboardDist, 'index.html'))
const dashboardStatus = skipDashboard
  ? (staticDashboardAvailable ? `http://localhost:${apiPort} (static)` : '(disabled)')
  : `http://localhost:${dashPort}`

if (!skipDashboard) {
  dashProc = spawn('npx', ['vite', '--host', dashboardHost, '--port', String(dashPort), '--strictPort'], {
    cwd: resolve('packages/dashboard'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  dashProc.stderr.on('data', (d) => {
    const msg = d.toString().trim()
    if (msg.includes('Local:') || msg.includes('ready in')) console.log(`  Dashboard: http://localhost:${dashPort}`)
  })
  ignoreBrokenPipe(dashProc.stderr)
}

console.log(`
  ───────────────────────────────────
  Ductum is running
  API:        http://localhost:${apiPort}
  Dashboard:  ${dashboardStatus}
  DB:         ${dbPath}${args.values.reset ? ' (reset on startup)' : ''}
  ───────────────────────────────────
  Next:
    Open the dashboard to see your projects
    Use the CLI: node packages/cli/dist/index.js status
    Press Ctrl+C to stop
`)

await new Promise(() => {})

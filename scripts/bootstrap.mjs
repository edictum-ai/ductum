#!/usr/bin/env node

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BOOTSTRAP_LOG_RELATIVE_PATH,
  BOOTSTRAP_STATE_RELATIVE_PATH,
  BOOTSTRAP_TIMEOUT_MS,
  checkBootstrapPrerequisites,
  formatProviderSource,
  resolveProviders,
  runCommand,
  runJsonCommand,
  sleep,
  spawnDetachedProcess,
  tailFile,
  waitForCondition,
  writeBootstrapState,
} from './bootstrap-support.mjs'
import {
  ensureOperatorToken,
  loadLocalEnv,
  resolveOperatorTokenHomePath,
  waitForApi,
} from './serve-helpers.mjs'
import { seedAgentProviders, seedFactoryDatabase } from './seed-db.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
// DB-only: the Factory lives in SQLite. The repo-root DB is the default; the
// bootstrap self-test overrides DUCTUM_DB_PATH / DUCTUM_BOOTSTRAP_TARGET_REPO
// to point at an isolated target repo. The factory directory is the directory
// that owns the DB (it holds .ductum/secrets.key and worktrees).
const TARGET_REPO = process.env.DUCTUM_BOOTSTRAP_TARGET_REPO?.trim()
const FACTORY_DIR = TARGET_REPO != null && TARGET_REPO !== '' ? resolve(TARGET_REPO) : ROOT
const DB_PATH = resolve(process.env.DUCTUM_DB_PATH ?? `${FACTORY_DIR}/ductum.db`)
const DEFAULT_SPEC_PATH = 'specs/examples/hello-readme'
const DEFAULT_PROJECT_NAME = 'ductum'

export async function main() {
  process.chdir(ROOT)
  loadLocalEnv({ cwd: ROOT, env: process.env })

  const prereqIssues = await checkBootstrapPrerequisites(process.env)
  if (prereqIssues.length > 0) {
    for (const line of prereqIssues) console.error(line)
    process.exitCode = 1
    return
  }
  const providers = await resolveProviders(process.env)
  const activeProvider = providers[0]
  if (activeProvider != null) {
    console.log(`==> Auth provider: ${formatProviderSource(activeProvider)}`)
  }

  const startedAt = Date.now()
  const state = {
    startedAt: new Date(startedAt).toISOString(),
    status: 'starting',
    dbPath: DB_PATH,
    factoryDir: FACTORY_DIR,
    apiUrl: null,
    dashboardUrl: null,
    specPath: DEFAULT_SPEC_PATH,
    targetRepoPath: TARGET_REPO ?? null,
    serverStarted: false,
    serverPid: null,
    serverLogPath: BOOTSTRAP_LOG_RELATIVE_PATH,
    specId: null,
    taskId: null,
    runId: null,
    approvalUrl: null,
  }
  writeBootstrapState(ROOT, state)

  console.log('==> Installing workspace dependencies')
  await runCommand('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: ROOT })

  console.log('==> Rebuilding trusted native dependencies')
  await runCommand('pnpm', ['rebuild', 'better-sqlite3', 'esbuild'], { cwd: ROOT })

  console.log('==> Building workspace')
  await runCommand('pnpm', ['build'], { cwd: ROOT })

  const apiPort = Number(process.env.DUCTUM_PORT ?? 4100)
  const dashboardPort = Number(process.env.DUCTUM_DASHBOARD_PORT ?? 5176)
  const apiUrl = `http://localhost:${apiPort}`
  const dashboardUrl = `http://localhost:${dashboardPort}`
  state.apiUrl = apiUrl
  state.dashboardUrl = dashboardUrl
  writeBootstrapState(ROOT, state)

  // DB-only seeding: create the Factory in SQLite before starting serve.mjs,
  // which is itself DB-only and refuses to start without a Factory record.
  const assignAgent = await seedFactoryIfNeeded(providers)

  const operatorTokenResult = await ensureOperatorToken({
    env: process.env,
    envPath: resolve(ROOT, '.env.local'),
    homeTokenPath: resolveOperatorTokenHomePath(process.env.HOME ?? homedir()),
    persistExisting: true,
  })
  const operatorToken = process.env.DUCTUM_OPERATOR_TOKEN?.trim() ?? ''
  if (operatorToken === '') throw new Error('bootstrap could not resolve DUCTUM_OPERATOR_TOKEN')
  if (operatorTokenResult.saved) {
    console.log(`==> Operator token ready in .env.local and ${operatorTokenResult.homeTokenPath}`)
  }

  if (!await waitForApi(apiUrl, 800)) {
    console.log('==> Starting Ductum serve runtime')
    const detached = spawnDetachedProcess('pnpm', ['serve'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DUCTUM_SKIP_BUILD: '1',
        DUCTUM_DB_PATH: DB_PATH,
      },
      logPath: BOOTSTRAP_LOG_RELATIVE_PATH,
    })
    state.serverStarted = true
    state.serverPid = detached.pid ?? null
    state.serverLogPath = detached.logPath
    writeBootstrapState(ROOT, state)

    const ready = await waitForApi(apiUrl, 20_000)
    if (!ready) {
      throw new Error(
        `Ductum API did not start within 20s.\n\nLast serve log lines:\n${tailFile(detached.logPath)}`,
      )
    }
  } else {
    console.log('==> Reusing existing Ductum API')
  }

  const { DuctumApiClient } = await import('../packages/cli/dist/api-client.js')
  const api = new DuctumApiClient(apiUrl)
  const dispatcherStatus = await api.getDispatcherStatus()
  if (!dispatcherStatus.enabled || !dispatcherStatus.running) {
    throw new Error(
      `Dispatcher is not running (${dispatcherStatus.reason ?? 'unknown reason'}).` +
      (state.serverStarted ? `\n\nLast serve log lines:\n${tailFile(state.serverLogPath)}` : ''),
    )
  }

  console.log(`==> Importing ${DEFAULT_SPEC_PATH}`)
  const intake = await runJsonCommand(
    'node',
    [
      'packages/cli/dist/index.js',
      '--api-url',
      apiUrl,
      '--json',
      'spec',
      'intake',
      DEFAULT_PROJECT_NAME,
      DEFAULT_SPEC_PATH,
      '--import',
    ],
    { cwd: ROOT, env: process.env },
  )
  const specId = intake?.import?.specId
  if (typeof specId !== 'string' || specId === '') {
    throw new Error(`Bootstrap spec import did not return a spec id:\n${JSON.stringify(intake, null, 2)}`)
  }
  state.specId = specId

  const tasks = await api.listTasks(specId)
  const task = tasks[0]
  if (task == null) {
    throw new Error(`Bootstrap spec ${specId} imported without a task`)
  }
  state.taskId = task.id
  writeBootstrapState(ROOT, state)

  console.log(`==> Assigning ${task.name} to ${assignAgent}`)
  await runCommand('node', ['packages/cli/dist/index.js', '--api-url', apiUrl, 'task', 'assign', '--', task.id, assignAgent], {
    cwd: ROOT,
    env: process.env,
  })

  console.log(`==> Approving spec ${specId}`)
  await runCommand('node', ['packages/cli/dist/index.js', '--api-url', apiUrl, 'spec', 'approve', specId], {
    cwd: ROOT,
    env: process.env,
  })

  const run = await waitForCondition(
    async () => {
      const runs = await api.listTaskRuns(task.id)
      return runs[0] ?? null
    },
    {
      timeoutMs: 120_000,
      intervalMs: 1000,
      timeoutMessage: `No run was dispatched for task ${task.id} within 120s`,
    },
  )
  state.runId = run.id
  state.approvalUrl = `${dashboardUrl}/runs/${encodeURIComponent(run.id)}`
  state.status = 'running'
  writeBootstrapState(ROOT, state)

  printOperatorGuide({
    apiUrl,
    dashboardUrl,
    approvalUrl: state.approvalUrl,
    runId: run.id,
  })

  console.log('==> Watching dispatch progress until approval')
  const approvalRun = await waitForApproval(api, run.id, startedAt)
  state.status = 'awaiting_approval'
  writeBootstrapState(ROOT, state)

  console.log('')
  console.log(`Reached human approval in ${formatDuration(Date.now() - startedAt)}.`)
  console.log(`Open ${state.approvalUrl} and click Approve once.`)
  console.log('After the merge lands, run:')
  console.log('  git log -1')
  if (state.serverStarted) {
    console.log(`Serve log: ${state.serverLogPath}`)
  }
  console.log(`State: ${BOOTSTRAP_STATE_RELATIVE_PATH}`)
  console.log(`Run:   ${approvalRun.id}`)
}

// Seed the Factory DB if it has no Factory yet, then return the agent name to
// assign the bootstrap task to. The seed picks agents from the operator's
// resolved providers (Anthropic / Codex / Copilot); the assigned agent is the
// first seeded agent so bootstrap never references an agent that does not
// exist.
async function seedFactoryIfNeeded(providers) {
  const { inspectFactoryDatabase } = await import('../packages/core/dist/index.js')
  const inspection = inspectFactoryDatabase(DB_PATH)
  if (inspection.state === 'has_factory') {
    console.log(`==> Reusing existing Factory in ${DB_PATH}`)
    const { initDb, SqliteAgentRepo } = await import('../packages/core/dist/index.js')
    const db = initDb(DB_PATH)
    try {
      const agent = new SqliteAgentRepo(db).list()[0]
      if (agent == null) throw new Error(`Factory DB ${DB_PATH} has no agents to assign the bootstrap task to`)
      return agent.name
    } finally {
      db.close()
    }
  }

  const agents = seedAgentProviders(providers)
  const seedAgents = agents.length > 0 ? agents : ['anthropic']
  console.log(`==> Seeding DB-only Factory at ${DB_PATH} (agents: ${seedAgents.join(', ')})`)
  const seed = await seedFactoryDatabase({
    dbPath: DB_PATH,
    factoryDir: FACTORY_DIR,
    projectName: DEFAULT_PROJECT_NAME,
    agents: seedAgents,
    ...(TARGET_REPO == null ? {} : {
      workflowProfilePath: resolve(TARGET_REPO, 'workflows', 'coding-guard-profile.yaml'),
    }),
  })
  const assignAgent = seed.agents[0]?.name
  if (assignAgent == null) throw new Error('bootstrap seeded a Factory without any agent to assign work to')
  return assignAgent
}

function printOperatorGuide({ apiUrl, dashboardUrl, approvalUrl, runId }) {
  console.log('')
  console.log('Ductum bootstrap is live.')
  console.log(`Dashboard: ${dashboardUrl}`)
  console.log(`Approval:  ${approvalUrl}`)
  console.log(`API:       ${apiUrl}`)
  console.log('Next commands:')
  console.log(`  pnpm ductum status ${runId}`)
  console.log(`  pnpm ductum watch ${runId}`)
  console.log('  git log -1')
  console.log('')
}

async function waitForApproval(api, runId, startedAt) {
  let lastStage = null
  let lastTerminal = null
  let lastPending = null

  return await waitForCondition(
    async () => {
      const run = await api.getRun(runId)
      if (
        run.stage !== lastStage
        || run.terminalState !== lastTerminal
        || run.pendingApproval !== lastPending
      ) {
        const label = run.terminalState != null
          ? `${run.stage} / ${run.terminalState}`
          : run.pendingApproval
            ? `${run.stage} / awaiting approval`
            : run.stage
        console.log(`  [${formatDuration(Date.now() - startedAt)}] ${label}`)
        lastStage = run.stage
        lastTerminal = run.terminalState
        lastPending = run.pendingApproval
      }
      if (run.pendingApproval === true && run.stage === 'ship') {
        return run
      }
      if (run.terminalState != null) {
        const failReason = run.failReason == null ? 'no fail reason recorded' : run.failReason
        throw new Error(`Run ${run.id} stopped before approval: ${run.terminalState} (${failReason})`)
      }
      return null
    },
    {
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      intervalMs: 1000,
      timeoutMessage: `Bootstrap timed out before approval after ${formatDuration(BOOTSTRAP_TIMEOUT_MS)}`,
    },
  )
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}

const invokedAsScript = process.argv[1] != null
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedAsScript) {
  main().catch(async (error) => {
    console.error('')
    console.error(error instanceof Error ? error.message : String(error))
    await sleep(0)
    process.exit(1)
  })
}

#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  envelope,
  exec,
  freePort,
  readIntEnv,
  stopProcessGroup,
  waitFor,
  waitForOutput,
} from './sse-cancel-demo-helpers.mjs'
import { seedFactoryDatabase } from '../seed-db.mjs'

// DB-only seeding produces a Codex builder agent named `codex-builder` (harness
// codex-sdk, model gpt-5.4) assigned to the seeded project as a builder.
const DEMO_PROJECT = 'demo'
const DEMO_AGENT = 'codex-builder'

const root = process.cwd()
const cli = resolve(root, 'packages/cli/dist/index.js')

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${JSON.stringify(envelope('demo.sse_cancel.failed', { message }))}\n`)
  process.exitCode = 1
})

async function main() {
  assertBuilt()
  const tmp = await mkdtemp(join(tmpdir(), 'ductum-demo-'))
  const token = `demo-${randomBytes(16).toString('hex')}`
  const apiPort = await freePort()
  const dashPort = await freePort()
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const env = {
    ...process.env,
    DUCTUM_OPERATOR_TOKEN: token,
    DUCTUM_PORT: String(apiPort),
    DUCTUM_DASHBOARD_PORT: String(dashPort),
    DUCTUM_MOCK_AGENT_CALLS: '1',
    // Mock demo: agents make no real call, but dispatch still requires the
    // agent's provider to be authenticated. Supply a placeholder so the demo
    // is hermetic under an isolated HOME (e.g. the bootstrap self-test verify
    // env, where ambient OpenAI creds are absent).
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'sk-mock-sse-cancel-demo',
    DUCTUM_MOCK_AGENT_DELAY_MS: String(readIntEnv('DUCTUM_DEMO_MOCK_DELAY_MS', 45000)),
    DUCTUM_EVENTS_HEARTBEAT_MS: String(readIntEnv('DUCTUM_DEMO_EVENTS_HEARTBEAT_MS', 30000)),
    DUCTUM_SKIP_BUILD: '1',
  }
  const state = { serve: null, events: null }

  try {
    // The demo repo IS the Factory directory: DB-only seeding wires the
    // project repo `.` at the Factory dir, so the dispatched run lands in the
    // demo git repo.
    const repoPath = join(tmp, 'repo')
    const dbPath = join(repoPath, 'ductum.db')
    const specPath = join(tmp, 'sse-cancel-demo.yaml')
    await createDemoRepo(repoPath)
    await seedFactoryDatabase({
      dbPath,
      factoryDir: repoPath,
      projectName: DEMO_PROJECT,
      agents: ['codex'],
    })
    await writeSpec(specPath)

    state.serve = startServe(dbPath, env)
    await state.serve.ready

    state.events = await startEvents(apiUrl, env)
    const imported = await runCliJson(['--api-url', apiUrl, '--json', 'spec', 'import', specPath, '--waive-contract'], env)
    const taskId = imported.tasks?.[0]?.id
    if (typeof taskId !== 'string') throw new Error('demo import did not return a task id')
    const agents = await apiJson(apiUrl, '/api/agents', env)
    const demoAgent = agents.find((agent) => agent.name === DEMO_AGENT)
    if (demoAgent == null) throw new Error(`demo agent ${DEMO_AGENT} was not loaded by the API`)

    // Event waits are generous and configurable: when this demo runs as the
    // bootstrap self-test's verify step it shares CPU with the orchestrating
    // serve + dispatcher, so the (correct) events arrive slower under load.
    const stepTimeoutMs = readIntEnv('DUCTUM_DEMO_STEP_TIMEOUT_MS', 30000)
    const dispatchedAt = Date.now()
    await apiJson(apiUrl, '/api/runs/dispatch', env, {
      method: 'POST',
      body: { taskId, agentId: demoAgent.id },
    })
    const dispatched = await state.events.waitFor('run.dispatched', () => true, stepTimeoutMs)
    const runId = dispatched.data.runId
    if (typeof runId !== 'string') throw new Error('run.dispatched event had no runId')

    // Wait until the run is actually active in the dispatcher before cancelling.
    // The seeded coding-guard workflow keeps the mock run in its first stage for
    // the whole mock delay, so we poll the live active-run count rather than
    // waiting on a mid-run stage transition that may not occur before cancel.
    const before = await waitFor(async () => {
      const status = await apiJson(apiUrl, '/api/factory/dispatcher', env)
      return status.activeRuns >= 1 ? status : null
    }, stepTimeoutMs, 'no active run appeared after dispatch')

    const heartbeatMs = readIntEnv('DUCTUM_DEMO_EVENTS_HEARTBEAT_MS', 30000)
    await state.events.waitFor('factory.events_stream_resumed', () => true, heartbeatMs + 2500)

    await runCliJson(['--api-url', apiUrl, '--json', 'cancel', '--reason', 'demo cancel', '--', runId], env)
    await state.events.waitFor('run.cancelled', (event) => event.data.runId === runId, stepTimeoutMs)
    await waitFor(async () => {
      const status = await apiJson(apiUrl, '/api/factory/dispatcher', env)
      return status.activeRuns <= before.activeRuns - 1 ? status : null
    }, stepTimeoutMs, 'dispatcher slot was not freed')

    const runStatus = await runCliJson(['--api-url', apiUrl, '--json', 'status', '--', runId], env)
    const run = runStatus.run
    if (run.terminalState !== 'cancelled') throw new Error(`expected cancelled run, got ${run.terminalState}`)
    const worktree = run.worktreePaths?.[0]
    if (typeof worktree !== 'string' || !existsSync(worktree)) {
      throw new Error(`preserved worktree not found: ${worktree ?? '<missing>'}`)
    }

    process.stdout.write(`${JSON.stringify(envelope('demo.sse_cancel.passed', {
      runId,
      taskId,
      elapsedMs: Date.now() - dispatchedAt,
      worktreePreserved: true,
    }), null, 2)}\n`)
  } finally {
    await state.events?.close()
    await state.serve?.close()
    if (process.env.DUCTUM_DEMO_KEEP_TMP !== '1') {
      await rm(tmp, { recursive: true, force: true })
    }
  }
}

function assertBuilt() {
  for (const path of [cli, resolve(root, 'packages/api/dist/index.js')]) {
    if (!existsSync(path)) throw new Error(`built artifact missing: ${path}; run pnpm build first`)
  }
}

async function createDemoRepo(repoPath) {
  await mkdir(repoPath, { recursive: true })
  await mkdir(join(repoPath, 'workflows'), { recursive: true })
  await exec('git', ['init', '-b', 'main'], { cwd: repoPath })
  await exec('git', ['config', 'user.email', 'demo@example.test'], { cwd: repoPath })
  await exec('git', ['config', 'user.name', 'Ductum Demo'], { cwd: repoPath })
  await writeFile(join(repoPath, 'README.md'), '# Demo\n', 'utf8')
  // The seeded project points at the built-in workflow path
  // (workflows/coding-guard.yaml + workflows/coding-guard-profile.yaml). Copy
  // the repo's built-in workflow into the fixture so the dispatched run can
  // load stages and stay active long enough for the cancel under test.
  for (const file of ['coding-guard.yaml', 'coding-guard-profile.yaml']) {
    await writeFile(join(repoPath, 'workflows', file), readFileSync(resolve(root, 'workflows', file), 'utf8'), 'utf8')
  }
  await exec('git', ['add', 'README.md', 'workflows'], { cwd: repoPath })
  await exec('git', ['commit', '-m', 'chore: seed demo repo'], { cwd: repoPath })
}

async function writeSpec(path) {
  const line = `demo-cancel-${randomBytes(4).toString('hex')}`
  await writeFile(path, [
    `project: ${DEMO_PROJECT}`,
    `spec:`,
    `  name: sse-cancel-demo`,
    `  status: approved`,
    `  document: SSE and cancel live demo fixture.`,
    `tasks:`,
    `  - name: demo-cancel-task`,
    `    status: blocked`,
    `    assignedAgent: ${DEMO_AGENT}`,
    `    requiredRole: builder`,
    `    repos: ["."]`,
    `    prompt: Append the line \`${line}\` to \`README.md\`.`,
    ``,
  ].join('\n'), 'utf8')
}

function startServe(dbPath, env) {
  const child = spawn('pnpm', ['serve', '--', '--db', dbPath, '--host', '127.0.0.1', '--no-dashboard'], {
    cwd: root,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  const ready = waitForOutput(child, logs, /Ductum is running/, 20000)
  return {
    ready,
    async close() {
      await stopProcessGroup(child, 'SIGTERM')
    },
  }
}

async function startEvents(apiUrl, env) {
  const controller = new AbortController()
  const response = await fetch(`${apiUrl}/api/events`, {
    headers: authHeaders(env),
    signal: controller.signal,
  })
  if (!response.ok || response.body == null) {
    throw new Error(`events stream failed: HTTP ${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let buffer = ''
  const waiters = []

  const emit = (event) => {
    events.push(event)
    for (const waiter of [...waiters]) waiter(event)
  }
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const records = buffer.split('\n\n')
      buffer = records.pop() ?? ''
      for (const record of records) {
        const event = parseSseRecord(record)
        if (event != null) emit(event)
      }
      if (done) break
    }
  })().catch((error) => {
    if (controller.signal.aborted) return
    const failed = { kind: 'demo.events.failed', data: { message: error instanceof Error ? error.message : String(error) } }
    emit(failed)
  })

  return {
    waitFor(kind, predicate, timeoutMs) {
      const found = events.find((event) => event.kind === kind && predicate(event))
      if (found != null) return Promise.resolve(found)
      return new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(onEvent), 1)
          rejectPromise(new Error(`timed out waiting for ${kind}`))
        }, timeoutMs)
        const onEvent = (event) => {
          if (event.kind !== kind || !predicate(event)) return
          clearTimeout(timer)
          waiters.splice(waiters.indexOf(onEvent), 1)
          resolvePromise(event)
        }
        waiters.push(onEvent)
      })
    },
    async close() {
      controller.abort()
      await reader.cancel().catch(() => undefined)
      await pump
    },
  }
}

async function runCliJson(args, env) {
  const { stdout } = await exec(process.execPath, [cli, ...args], { env, cwd: root, timeout: 15000 })
  return JSON.parse(stdout)
}

async function apiJson(apiUrl, path, env, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...authHeaders(env),
      ...(init.body == null ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body == null ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  const json = text === '' ? null : JSON.parse(text)
  if (!response.ok) {
    throw new Error(`API ${init.method ?? 'GET'} ${path} failed: ${text || response.status}`)
  }
  return json
}

function authHeaders(env) {
  const token = env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token == null || token === '' ? {} : { 'x-ductum-operator-token': token }
}

function parseSseRecord(record) {
  let kind = null
  const data = []
  for (const line of record.split('\n')) {
    if (line.startsWith('event:')) kind = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart())
  }
  if (data.length === 0) return null
  const parsed = JSON.parse(data.join('\n'))
  return {
    kind: parsed.kind ?? kind,
    data: parsed.data ?? parsed,
    ts: parsed.ts,
  }
}

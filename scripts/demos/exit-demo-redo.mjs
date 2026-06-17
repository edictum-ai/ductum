#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { hostname, homedir, platform, release } from 'node:os'
import { join } from 'node:path'

import {
  ExitDemoError,
  buildExitDemoEvidence,
  envelope,
  errorEnvelope,
  findApiProcessFromPsOutput,
  forbiddenEnvFindings,
  machineSignature,
  selectFirstAwaitingApprovalRun,
  selectMergedRunStatus,
  validateExitDemoEvidence,
} from './exit-demo-redo-lib.mjs'

const args = parseArgs(process.argv.slice(2))
const t0 = Date.now()
const timeline = []

main().catch(async (error) => {
  const code = error instanceof ExitDemoError ? error.code : 'exit_demo_failed'
  const context = error instanceof ExitDemoError ? error.context : {}
  const message = error instanceof Error ? error.message : String(error)
  await writeJson(join(args.evidenceDir, 'exit_demo_error.json'), errorEnvelope(code, message, context)).catch(() => {})
  process.stdout.write(`${JSON.stringify(errorEnvelope(code, message, context), null, 2)}\n`)
  process.exitCode = 1
})

async function main() {
  await mkdir(args.evidenceDir, { recursive: true })
  const envFindings = forbiddenEnvFindings(process.env, existsSync(join(homedir(), '.claude')))
  await writeJson(join(args.evidenceDir, 'pre_prereq_env.json'), envelope('exit_demo.preflight', {
    forbiddenFindings: envFindings,
    node: process.version,
    package: args.packageName,
    installTool: args.installTool,
    factoryDir: args.factoryDir,
  }))
  if (envFindings.length > 0) {
    throw new ExitDemoError('exit_demo_pre_existing_creds', 'fresh-machine credential preflight failed', { findings: envFindings })
  }
  if (await commandExists('ductum')) {
    throw new ExitDemoError('exit_demo_pre_existing_creds', 'fresh-machine preflight found an existing global ductum binary', {
      findings: [{ kind: 'global-bin', name: 'ductum' }],
    })
  }

  // pnpm 10 disables install scripts by default (security). better-sqlite3 needs
  // its native binding built. Without --allow-build, the API fails to load the
  // module at startup. npm runs install scripts by default, so no flag needed there.
  // D160: harness allow-list better-sqlite3 explicitly for pnpm path.
  const installArgs = args.installTool === 'pnpm'
    ? ['install', '-g', '--allow-build=better-sqlite3', args.packageName]
    : ['install', '-g', args.packageName]
  await run(args.installTool, installArgs, { cwd: homedir(), stdio: 'inherit' })
  mark('install_g')
  await run('ductum', ['init'], { cwd: homedir(), stdio: 'inherit' })
  mark('init_anthropic_auth')

  const apiUrl = args.apiUrl ?? await waitFor(async () => {
    const ps = await execJsonless('ps', ['-axo', 'pid=,command='])
    return findApiProcessFromPsOutput(ps.stdout, args.factoryDir)?.apiUrl ?? null
  }, args.timeoutMs, 'Ductum API process was not found for the initialized factory')
  await waitFor(() => runCliJson(apiUrl, ['status']).then(() => apiUrl).catch(() => null), 30000, 'Ductum API did not answer status')
  mark('serve_ready')

  process.stderr.write('Waiting for /welcome sample import. Click "Import sample spec (hello-readme)" in the dashboard.\n')
  await waitFor(() => hasHelloReadme(apiUrl), args.timeoutMs, 'hello-readme spec was not imported')
  mark('spec_imported')

  const approval = await waitFor(async () => {
    const runs = await listRuns(apiUrl)
    return selectFirstAwaitingApprovalRun(runs)
  }, args.timeoutMs, 'run never reached awaiting approval')
  const runId = approval.run.id
  mark('run_awaiting_approval')

  process.stderr.write(`Waiting for one dashboard approval click on run ${runId}.\n`)
  await waitFor(async () => {
    const status = await runCliJson(apiUrl, ['status', '--', runId])
    return status.run?.pendingApproval === false ? status : null
  }, args.timeoutMs, 'approval click was not observed')
  mark('approve_clicked')

  const merged = await waitFor(async () => {
    const status = await runCliJson(apiUrl, ['status', '--', runId])
    return selectMergedRunStatus(status)
  }, args.timeoutMs, 'run did not merge')
  mark('merged')

  const evidence = buildExitDemoEvidence({
    machineSignature: machineSignature({ platform: platform(), release: release(), hostname: hostname() }),
    timeline,
    totalMs: Date.now() - t0,
    ...merged,
  })
  const evidencePath = join(args.evidenceDir, 'p5-exit-demo.json')
  await writeJson(evidencePath, evidence)
  validateExitDemoEvidence(evidence)
  await apiJson(apiUrl, `/api/runs/${encodeURIComponent(runId)}/evidence`, {
    method: 'POST',
    body: { type: 'exit_demo.run', payload: evidence },
  })
    .catch((error) => {
      throw new ExitDemoError('exit_demo_evidence_write_failed', 'failed to attach exit demo evidence to the factory ledger', {
        cause: error instanceof Error ? error.message : String(error),
        runId,
      })
    })
  process.stdout.write(`${JSON.stringify(envelope('exit_demo.run', {
    evidencePath,
    runId,
    totalSeconds: evidence.data.totalSeconds,
    mergedCommitSha: evidence.data.mergedCommitSha,
  }), null, 2)}\n`)
}

function mark(phase) {
  timeline.push({ phase, t: Date.now() - t0 })
}

async function hasHelloReadme(apiUrl) {
  const projects = await apiJson(apiUrl, '/api/projects').catch(() => [])
  for (const project of projects) {
    const specs = await apiJson(apiUrl, `/api/projects/${encodeURIComponent(project.id)}/specs`).catch(() => [])
    if (specs.some((spec) => spec.name === 'hello-readme')) return true
    for (const spec of specs) {
      const tasks = await apiJson(apiUrl, `/api/specs/${encodeURIComponent(spec.id)}/tasks`).catch(() => [])
      if (tasks.some((task) => task.name === 'P1-HELLO-README' || task.name.includes('hello-readme'))) return true
    }
  }
  const runs = await apiJson(apiUrl, '/api/runs').catch(() => [])
  return runs.some((record) => record?.spec?.name === 'hello-readme' || record?.task?.name === 'P1-HELLO-README')
}

async function listRuns(apiUrl) {
  return apiJson(apiUrl, '/api/runs').catch(() => [])
}

function runCliJson(apiUrl, cliArgs) {
  return execJsonless('ductum', ['--api-url', apiUrl, '--json', ...cliArgs], { cwd: args.factoryDir }).then((result) =>
    JSON.parse(result.stdout))
}

async function apiJson(apiUrl, path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...authHeaders(),
      ...(init.body == null ? {} : { 'content-type': 'application/json' }),
    },
    body: init.body == null ? undefined : JSON.stringify(init.body),
  })
  const text = await response.text()
  const json = text === '' ? null : JSON.parse(text)
  if (!response.ok) throw new Error(`API ${init.method ?? 'GET'} ${path} failed: ${text || response.status}`)
  return json
}

function authHeaders() {
  const token = process.env.DUCTUM_OPERATOR_TOKEN?.trim()
  return token == null || token === '' ? {} : { 'x-ductum-operator-token': token }
}

function run(command, cmdArgs, options = {}) {
  return execJsonless(command, cmdArgs, options).then(() => undefined)
}

async function commandExists(command) {
  return execJsonless(command, ['--version'], { cwd: homedir() }).then(() => true, () => false)
}

function execJsonless(command, cmdArgs, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, cmdArgs, { ...options, shell: false, env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`${command} ${cmdArgs.join(' ')} failed: ${stderr || signal || code}`))
    })
  })
}

async function waitFor(fn, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value != null) return value
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  throw new ExitDemoError('exit_demo_missing_checkpoint', message)
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const parsed = {
    packageName: 'ductum@0.1.0',
    installTool: 'pnpm',
    factoryDir: join(homedir(), 'ductum', 'factory'),
    evidenceDir: join('/tmp', 'exit-demo-redo-evidence', timestamp),
    timeoutMs: 600000,
    apiUrl: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--package') parsed.packageName = required(argv[++index], arg)
    else if (arg === '--install-tool') parsed.installTool = installTool(required(argv[++index], arg))
    else if (arg === '--factory-dir') parsed.factoryDir = required(argv[++index], arg)
    else if (arg === '--evidence-dir') parsed.evidenceDir = required(argv[++index], arg)
    else if (arg === '--api-url') parsed.apiUrl = required(argv[++index], arg)
    else if (arg === '--timeout-seconds') parsed.timeoutMs = Number(required(argv[++index], arg)) * 1000
    else if (arg === '--json') continue
    else throw new ExitDemoError('exit_demo_failed', `unknown option: ${arg}`)
  }
  return parsed
}

function required(value, option) {
  if (value == null || value === '') throw new ExitDemoError('exit_demo_failed', `${option} requires a value`)
  return value
}

function installTool(value) {
  if (value === 'pnpm' || value === 'npm') return value
  throw new ExitDemoError('exit_demo_failed', `--install-tool must be pnpm or npm, got ${value}`)
}

#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  BOOTSTRAP_LOG_RELATIVE_PATH,
  BOOTSTRAP_TIMEOUT_MS,
  readBootstrapState,
  runCommand,
  sleep,
  tailFile,
  waitForCondition,
} from './bootstrap-support.mjs'
import { loadLocalEnv } from './serve-helpers.mjs'

const execFileAsync = promisify(execFile)
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PROOF_LINE = 'Bootstrap proof: hello from Ductum.'

async function main() {
  const startedAt = Date.now()
  if (await resumeCompletedBootstrap(startedAt)) return

  const home = mkdtempSync(join(tmpdir(), 'ductum-bootstrap-home-'))
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'ductum-bootstrap-target-'))
  const target = createBootstrapTarget(fixtureRoot)
  const apiPort = 4100 + Number(process.pid % 500)
  const dashboardPort = apiPort + 1000
  // Resolve the real pnpm store before HOME is overridden below.
  const storeDir = resolvePnpmStoreDir()
  const env = {
    ...process.env,
    HOME: home,
    // Bootstrap runs under a throwaway HOME for isolation, which points pnpm at
    // an empty store and makes `pnpm install` purge and reinstall node_modules.
    // That purge prompts for confirmation and blocks this non-interactive run
    // forever. Pin the store back to the real one (keeps the install warm and
    // avoids the purge) and disable the purge confirmation as a hard guarantee
    // the install can never block on stdin.
    ...(storeDir != null ? { npm_config_store_dir: storeDir } : {}),
    npm_config_confirm_modules_purge: 'false',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'bootstrap-self-test-key',
    DUCTUM_MOCK_AGENT_CALLS: '1',
    DUCTUM_PORT: String(apiPort),
    DUCTUM_DASHBOARD_PORT: String(dashboardPort),
    // DB-only: the target repo is the Factory directory. bootstrap seeds the DB
    // at <target>/ductum.db and writes <target>/.ductum/secrets.key. No
    // ductum.yaml.
    DUCTUM_BOOTSTRAP_TARGET_REPO: target.repoPath,
    DUCTUM_DB_PATH: join(target.repoPath, 'ductum.db'),
  }

  let serverPid = null
  try {
    cleanupBootstrapWorkspace(ROOT)

    console.log(`Bootstrap self-test started at ${new Date(startedAt).toISOString()}`)
    await runCommand('pnpm', ['bootstrap'], { cwd: ROOT, env })

    const state = readBootstrapState(ROOT)
    if (state == null || state.status !== 'awaiting_approval' || typeof state.runId !== 'string') {
      throw new Error(`bootstrap did not stop at approval with a recorded run id:\n${JSON.stringify(state, null, 2)}`)
    }
    serverPid = typeof state.serverPid === 'number' ? state.serverPid : null

    console.log(`Approving run ${state.runId}`)
    await runCommand('node', ['packages/cli/dist/index.js', '--api-url', state.apiUrl, 'approve', '--', state.runId], { cwd: ROOT, env })

    loadLocalEnv({ cwd: ROOT, env: process.env })
    const { DuctumApiClient } = await import('../packages/cli/dist/api-client.js')
    const api = new DuctumApiClient(state.apiUrl)
    await waitForCondition(
      async () => {
        const run = await api.getRun(state.runId)
        if (run.stage === 'done' && run.terminalState == null) return run
        if (run.terminalState != null) {
          throw new Error(`approved run failed after approval: ${run.terminalState} (${run.failReason ?? 'no reason'})`)
        }
        return null
      },
      {
        timeoutMs: 120_000,
        intervalMs: 1000,
        timeoutMessage: 'merge did not finish within 120s after approval',
      },
    )

    const readme = readFileSync(resolve(target.repoPath, 'README.md'), 'utf-8')
    if (!readme.includes(PROOF_LINE)) {
      throw new Error(`target README.md does not contain the bootstrap proof line after approval: ${target.repoPath}`)
    }

    const { stdout: subject } = await execFileAsync('git', ['-C', target.repoPath, 'log', '-1', '--pretty=%s'], {
      encoding: 'utf-8',
    })
    console.log(`Latest commit: ${subject.trim()}`)

    const elapsedMs = Date.now() - startedAt
    console.log(`Bootstrap self-test finished in ${Math.round(elapsedMs / 1000)}s`)
    if (elapsedMs > BOOTSTRAP_TIMEOUT_MS) {
      throw new Error(`bootstrap self-test exceeded 10 minutes (${elapsedMs}ms)`)
    }
  } finally {
    if (serverPid != null) {
      await stopServerProcess(serverPid)
    }
    rmSync(home, { recursive: true, force: true })
  }
}

async function resumeCompletedBootstrap(startedAt) {
  const state = readBootstrapState(ROOT)
  if (state == null || typeof state.apiUrl !== 'string' || typeof state.runId !== 'string') return false
  if (typeof state.targetRepoPath !== 'string' || state.targetRepoPath.trim() === '') return false

  const readmePath = resolve(state.targetRepoPath, 'README.md')
  if (!existsSync(readmePath)) return false
  const readme = readFileSync(readmePath, 'utf-8')
  if (!readme.includes(PROOF_LINE)) return false

  loadLocalEnv({ cwd: ROOT, env: process.env })
  const { DuctumApiClient } = await import('../packages/cli/dist/api-client.js')
  const api = new DuctumApiClient(state.apiUrl)
  let run
  try {
    run = await api.getRun(state.runId)
  } catch {
    return false
  }
  if (run.stage !== 'done' || run.terminalState != null) return false

  try {
    await execFileAsync('git', ['-C', state.targetRepoPath, 'merge-base', '--is-ancestor', run.commitSha, 'HEAD'])
  } catch {
    return false
  }

  const { stdout: subject } = await execFileAsync('git', ['-C', state.targetRepoPath, 'log', '-1', '--pretty=%s'], {
    encoding: 'utf-8',
  })
  console.log(`Bootstrap self-test resumed completed run ${state.runId}`)
  console.log(`Latest commit: ${subject.trim()}`)
  console.log(`Bootstrap self-test finished in ${Math.round((Date.now() - startedAt) / 1000)}s`)

  if (typeof state.serverPid === 'number') {
    await stopServerProcess(state.serverPid)
  }
  return true
}

function createBootstrapTarget(fixtureRoot) {
  const repoPath = join(fixtureRoot, 'repo')
  const profileDir = join(repoPath, '.edictum')
  const workflowsDir = join(repoPath, 'workflows')
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(workflowsDir, { recursive: true })
  writeFileSync(
    join(repoPath, 'README.md'),
    '# Bootstrap self-test fixture\n\nReady for a Ductum proof line.\n',
  )
  writeFileSync(
    join(repoPath, '.gitignore'),
    [
      '.ductum/',
      'ductum.db',
      'ductum.db-shm',
      'ductum.db-wal',
      '',
    ].join('\n'),
  )
  writeFileSync(join(profileDir, 'workflow-profile.yaml'), bootstrapWorkflowProfile())
  // DB-only seeding wires the project at the generic built-in workflow path
  // (workflows/coding-guard.yaml + workflows/coding-guard-profile.yaml). The
  // fixture repo provides matching files so the seeded Factory resolves a
  // workflow + verify that grep the proof line without requiring a remote push.
  writeFileSync(join(workflowsDir, 'coding-guard.yaml'), bootstrapWorkflowStages())
  writeFileSync(join(workflowsDir, 'coding-guard-profile.yaml'), bootstrapWorkflowProfile())
  runGit(repoPath, ['init'])
  runGit(repoPath, ['branch', '-M', 'main'])
  runGit(repoPath, ['config', 'user.name', 'Ductum Self Test'])
  runGit(repoPath, ['config', 'user.email', 'self-test@ductum.local'])
  runGit(repoPath, ['config', 'commit.gpgsign', 'false'])
  runGit(repoPath, ['config', 'tag.gpgsign', 'false'])
  runGit(repoPath, ['add', 'README.md', '.gitignore', '.edictum/workflow-profile.yaml', 'workflows/coding-guard.yaml', 'workflows/coding-guard-profile.yaml'])
  runGit(repoPath, ['commit', '--no-verify', '-m', 'chore: seed bootstrap fixture'])

  return { repoPath }
}

function bootstrapWorkflowStages() {
  return [
    'apiVersion: edictum/v1',
    'kind: Workflow',
    'metadata:',
    '  name: coding-guard',
    '  version: "bootstrap-self-test"',
    '  description: Local-merge proof workflow for the bootstrap self-test',
    '',
    'stages:',
    '  - id: understand',
    '    description: Read the task brief before editing',
    '    tools: [Read, Grep, Glob, Bash]',
    '    exit:',
    '      - condition: file_read("README.md")',
    '        message: Read README.md before editing',
    '',
    '  - id: implement',
    '    description: Make the change and verify locally',
    '    entry:',
    '      - condition: stage_complete("understand")',
    '    tools: [Read, Grep, Glob, Edit, Write, Bash]',
    '',
    '  - id: ship',
    '    description: Factory-controlled ship boundary after verification and review',
    '    entry:',
    '      - condition: stage_complete("implement")',
    '    tools: [Read, Grep, Bash]',
    '    approval:',
    '      message: Approve only after bootstrap self-test review passes',
    '',
    '  - id: done',
    '    description: All workflow stages complete',
    '    entry:',
    '      - condition: stage_complete("ship")',
    '',
  ].join('\n')
}

function bootstrapWorkflowProfile() {
  return [
    'apiVersion: edictum/v1alpha1',
    'kind: WorkflowProfile',
    'metadata:',
    '  name: bootstrap-self-test',
    '  description: Isolated workflow profile for the bootstrap self-test',
    '',
    'context:',
    '  required_files:',
    '    - README.md',
    '  optional_files: []',
    '',
    'setup:',
    '  commands: []',
    '',
    'verify:',
    '  commands:',
    `    - ${yamlString(`git show --format= -- README.md | grep "+${PROOF_LINE}"`)}`,
    `    - ${yamlString(`tail -n 5 README.md | grep "${PROOF_LINE}"`)}`,
    '',
    'review:',
    '  approval_message: Approve only after bootstrap self-test review passes',
    '',
    'push:',
    '  protected_branches:',
    '    - main',
    '  allowed_git_commands:',
    '    - git status',
    '    - git diff',
    '    - git add',
    '    - git commit',
    '    - git log',
    '    - git show',
    '',
  ].join('\n')
}

function runGit(repoPath, args) {
  execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' })
}

function yamlString(value) {
  return JSON.stringify(value)
}

async function stopServerProcess(pid) {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try { process.kill(pid, 'SIGTERM') } catch {}
  }
  await sleep(250)
}

function resolvePnpmStoreDir() {
  try {
    const path = execFileSync('pnpm', ['store', 'path'], { encoding: 'utf-8' }).trim()
    return path === '' ? null : path
  } catch {
    return null
  }
}

function cleanupBootstrapWorkspace(root) {
  for (const path of [
    '.env.local',
    'ductum.db',
    'ductum.db-shm',
    'ductum.db-wal',
    '.ductum/bootstrap',
  ]) {
    rmSync(resolve(root, path), { recursive: true, force: true })
  }
  const tokenPath = resolve(root, '.ductum', 'operator-token')
  if (existsSync(tokenPath)) rmSync(tokenPath, { force: true })
}

const invokedAsScript = process.argv[1] != null
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])

function printServeLogTail() {
  try {
    const state = readBootstrapState(ROOT)
    const logPath = state?.serverLogPath ?? resolve(ROOT, BOOTSTRAP_LOG_RELATIVE_PATH)
    console.error('\n--- serve log (tail) ---')
    console.error(tailFile(logPath, 4000))
  } catch (error) {
    console.error(`(could not read serve log: ${error instanceof Error ? error.message : String(error)})`)
  }
}

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    printServeLogTail()
    process.exit(1)
  })
}

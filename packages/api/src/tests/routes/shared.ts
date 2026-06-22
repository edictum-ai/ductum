import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, vi as vitestVi } from 'vitest'
import type { TestFixture } from '../helpers.js'
export { describe, expect, it, vi } from 'vitest'
export { createId } from '@ductum/core'
export type { Run } from '@ductum/core'
export { enforceCostBudget, mergeApprovedRun, precheckCostBudget } from '../../lib/run-ops.js'
export { SESSION_CONTROL_TOKEN_HEADER } from '../../lib/session-control.js'
export { createFixture, requestJson, seedBase, waitForSse, type TestFixture } from '../helpers.js'
export { join, mkdtemp, rm, tmpdir, writeFile }
export const execFileAsync = promisify(execFile)
export const workflowProfilePath = fileURLToPath(new URL('../../../../../.edictum/workflow-profile.yaml', import.meta.url))
export function registerRouteTestCleanup(getFixture: () => TestFixture | undefined, clearFixture: () => void) {
  afterEach(() => { vitestVi.restoreAllMocks(); vitestVi.unstubAllGlobals(); getFixture()?.close(); clearFixture() })
}
export async function setupMergeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ductum-merge-'))
  const upstream = join(root, 'upstream'); const worktree = join(root, 'wt')
  await execFileAsync('git', ['init', '-b', 'main', upstream])
  await execFileAsync('git', ['-C', upstream, 'config', 'user.email', 'test@example.com']); await execFileAsync('git', ['-C', upstream, 'config', 'user.name', 'Test'])
  await writeFile(join(upstream, 'README.md'), '# initial\n'); await execFileAsync('git', ['-C', upstream, 'add', 'README.md']); await execFileAsync('git', ['-C', upstream, 'commit', '-m', 'initial'])
  await execFileAsync('git', ['-C', upstream, 'worktree', 'add', worktree, '-B', 'feature/x'])
  await execFileAsync('git', ['-C', worktree, 'config', 'user.email', 'test@example.com']); await execFileAsync('git', ['-C', worktree, 'config', 'user.name', 'Test'])
  await writeFile(join(worktree, 'feature.txt'), 'hello\n'); await execFileAsync('git', ['-C', worktree, 'add', 'feature.txt']); await execFileAsync('git', ['-C', worktree, 'commit', '-m', 'add feature'])
  return { upstream, worktree, cleanup: async () => { await execFileAsync('git', ['-C', upstream, 'worktree', 'remove', worktree, '--force']).catch(() => undefined); await rm(root, { recursive: true, force: true }).catch(() => undefined) } }
}
export async function setupFakeGh(options: { branch?: string; prNumber?: number; prUrl?: string; failMerge?: boolean; failAfterMerge?: boolean } = {}) {
  const binDir = await mkdtemp(join(tmpdir(), 'ductum-gh-')); const ghPath = join(binDir, 'gh'); const logPath = join(binDir, 'gh.log')
  const script = [
    '#!/usr/bin/env node',
    "import { appendFileSync } from 'node:fs'",
    "import { execFileSync } from 'node:child_process'",
    'const args = process.argv.slice(2)',
    "appendFileSync(process.env.DUCTUM_TEST_GH_LOG, JSON.stringify({ cwd: process.cwd(), args }) + '\\n')",
    "if (process.env.DUCTUM_TEST_GH_FAIL === '1' && args[0] === 'pr' && args[1] === 'merge') { process.stderr.write('simulated gh merge failure\\n'); process.exit(1) }",
    "const branch = process.env.DUCTUM_TEST_GH_BRANCH ?? 'feature/x'",
    "const prUrl = process.env.DUCTUM_TEST_GH_PR_URL ?? 'https://github.com/acartag7/ductum/pull/42'",
    "const prNumber = Number(process.env.DUCTUM_TEST_GH_PR_NUMBER ?? '42')",
    "if (args[0] === 'pr' && args[1] === 'merge') {",
    "  const subjectIndex = args.indexOf('--subject'); const bodyIndex = args.indexOf('--body')",
    "  const subject = subjectIndex === -1 ? 'Merged via fake gh' : args[subjectIndex + 1]; const body = bodyIndex === -1 ? '' : args[bodyIndex + 1]",
    "  const message = body === '' ? subject : `${subject}\\n\\n${body}`",
    "  execFileSync('git', ['-C', process.cwd(), 'checkout', 'main'], { stdio: 'pipe' })",
    "  execFileSync('git', ['-C', process.cwd(), 'merge', '--no-ff', '-m', message, branch], { stdio: 'pipe' })",
    "  if (process.env.DUCTUM_TEST_GH_FAIL_AFTER_MERGE === '1') { process.stderr.write('simulated gh failure after merge\\n'); process.exit(1) }",
    "  process.stdout.write('merged\\n'); process.exit(0)",
    '}',
    "if (args[0] === 'pr' && args[1] === 'view') {",
    "  const sha = execFileSync('git', ['-C', process.cwd(), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()",
    "  process.stdout.write(JSON.stringify({ mergeCommit: { oid: sha }, headRefName: branch, baseRefName: 'main', number: prNumber, url: prUrl })); process.exit(0)",
    '}',
    "process.stderr.write(`unexpected gh invocation: ${args.join(' ')}\\n`); process.exit(1)",
  ].join('\n') + '\n'
  await writeFile(ghPath, script); await chmod(ghPath, 0o755)
  const original = { PATH: process.env.PATH, DUCTUM_TEST_GH_LOG: process.env.DUCTUM_TEST_GH_LOG, DUCTUM_TEST_GH_BRANCH: process.env.DUCTUM_TEST_GH_BRANCH, DUCTUM_TEST_GH_PR_NUMBER: process.env.DUCTUM_TEST_GH_PR_NUMBER, DUCTUM_TEST_GH_PR_URL: process.env.DUCTUM_TEST_GH_PR_URL, DUCTUM_TEST_GH_FAIL: process.env.DUCTUM_TEST_GH_FAIL, DUCTUM_TEST_GH_FAIL_AFTER_MERGE: process.env.DUCTUM_TEST_GH_FAIL_AFTER_MERGE }
  process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`
  process.env.DUCTUM_TEST_GH_LOG = logPath; process.env.DUCTUM_TEST_GH_BRANCH = options.branch ?? 'feature/x'; process.env.DUCTUM_TEST_GH_PR_NUMBER = String(options.prNumber ?? 42); process.env.DUCTUM_TEST_GH_PR_URL = options.prUrl ?? 'https://github.com/acartag7/ductum/pull/42'; process.env.DUCTUM_TEST_GH_FAIL = options.failMerge === true ? '1' : '0'; process.env.DUCTUM_TEST_GH_FAIL_AFTER_MERGE = options.failAfterMerge === true ? '1' : '0'
  return { logPath, readLog: async () => await readFile(logPath, 'utf-8').catch(() => ''), cleanup: async () => {
    process.env.PATH = original.PATH; process.env.DUCTUM_TEST_GH_LOG = original.DUCTUM_TEST_GH_LOG; process.env.DUCTUM_TEST_GH_BRANCH = original.DUCTUM_TEST_GH_BRANCH; process.env.DUCTUM_TEST_GH_PR_NUMBER = original.DUCTUM_TEST_GH_PR_NUMBER; process.env.DUCTUM_TEST_GH_PR_URL = original.DUCTUM_TEST_GH_PR_URL; process.env.DUCTUM_TEST_GH_FAIL = original.DUCTUM_TEST_GH_FAIL; process.env.DUCTUM_TEST_GH_FAIL_AFTER_MERGE = original.DUCTUM_TEST_GH_FAIL_AFTER_MERGE
    await rm(binDir, { recursive: true, force: true }).catch(() => undefined)
  } }
}

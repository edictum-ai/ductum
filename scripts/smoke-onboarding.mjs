#!/usr/bin/env node

/**
 * smoke-onboarding.mjs — Clean container onboarding smoke test.
 *
 * Proves the fresh agent-first install path works without Arnold-specific
 * state, hardcoded local paths, or manual env edits.
 *
 * This script runs the FULL clean checkout pipeline:
 *   pnpm install --frozen-lockfile → pnpm build → pnpm test
 *   then verifies configs, CLI, token bootstrap, and onboarding docs.
 *
 * Usage:
 *   node scripts/smoke-onboarding.mjs
 *
 * Exit codes:
 *   0  all checks pass
 *   1  one or more checks fail
 */

import { existsSync, readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
let passed = 0
let failed = 0

async function check(name, fn) {
  try {
    const result = typeof fn === 'function' ? fn() : fn
    const resolved = result instanceof Promise ? await result : result
    if (resolved === true) {
      console.log(`  PASS  ${name}`)
      passed++
    } else {
      console.log(`  FAIL  ${name}: ${resolved}`)
      failed++
    }
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err.message}`)
    failed++
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
}

function runMustFail(cmd, opts = {}) {
  try {
    execSync(cmd, { cwd: ROOT, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...opts })
    return null // did not fail
  } catch (err) {
    return err
  }
}

function readText(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf-8')
}

async function main() {
console.log('\nDuctum Clean Container Onboarding Smoke')
console.log('='.repeat(50))
console.log(`Root: ${ROOT}\n`)

// ── 1. Install ──────────────────────────────────────────────────────────────

console.log('1. Install (pnpm install --frozen-lockfile)')

await check('pnpm install --frozen-lockfile exits 0', () => {
  run('pnpm install --frozen-lockfile', { stdio: ['pipe', 'pipe', 'pipe'] })
  return true
})

// ── 2. Build ────────────────────────────────────────────────────────────────

console.log('\n2. Build (pnpm build)')

await check('pnpm build exits 0', () => {
  run('pnpm build', { stdio: ['pipe', 'pipe', 'pipe'] })
  return true
})

for (const pkg of ['core', 'api', 'cli', 'mcp', 'harness']) {
  await check(`packages/${pkg}/dist/index.js exists after build`, () =>
    existsSync(resolve(ROOT, `packages/${pkg}/dist/index.js`)) ? true : 'missing')
}

await check('packages/dashboard/dist/index.html exists after build', () =>
  existsSync(resolve(ROOT, 'packages/dashboard/dist/index.html')) ? true : 'missing')

// ── 3. Test ─────────────────────────────────────────────────────────────────

console.log('\n3. Test (pnpm test)')

await check('pnpm test exits 0', () => {
  run('pnpm test', { stdio: ['pipe', 'pipe', 'pipe'] })
  return true
})

// ── 4. DB-only model — no root config files leak Arnold state ─────────────────

console.log('\n4. DB-only model (no root ductum.yaml)')

// P3 removed ductum.yaml from normal operation. Guard against reintroduction:
// init writes the Factory + .ductum/secrets.key into SQLite, not a tracked
// config file, so a fresh checkout must ship without these root configs.
await check('no root ductum.yaml (reintroduction guard)', () =>
  existsSync(resolve(ROOT, 'ductum.yaml')) ? 'ductum.yaml was reintroduced at the repo root' : true)

await check('no root ductum.example.yaml (reintroduction guard)', () =>
  existsSync(resolve(ROOT, 'ductum.example.yaml')) ? 'ductum.example.yaml was reintroduced at the repo root' : true)

await check('no root ductum.docker.yaml (reintroduction guard)', () =>
  existsSync(resolve(ROOT, 'ductum.docker.yaml')) ? 'ductum.docker.yaml was reintroduced at the repo root' : true)

await check('.env.example has placeholder token', () => {
  const text = readText('.env.example')
  return text.includes('replace-me-with-a-long-random-token') ? true : 'missing placeholder token'
})

await check('.gitignore covers .env.local', () => {
  const text = readText('.gitignore')
  return (text.includes('.env.*') || text.includes('.env.local')) ? true : 'missing .env.* or .env.local'
})

// ── 5. CLI commands work ────────────────────────────────────────────────────

console.log('\n5. CLI commands')

await check('CLI --help returns 0', () => { run('node packages/cli/dist/index.js --help'); return true })
await check('CLI status --help returns 0', () => { run('node packages/cli/dist/index.js status --help'); return true })
await check('CLI doctor --help returns 0', () => { run('node packages/cli/dist/index.js doctor --help'); return true })
await check('CLI onboard --help returns 0', () => { run('node packages/cli/dist/index.js onboard --help'); return true })
await check('CLI repair --help returns 0', () => { run('node packages/cli/dist/index.js repair --help'); return true })
await check('CLI project create --help returns 0', () => { run('node packages/cli/dist/index.js project create --help'); return true })

// ── 6. First-run token bootstrap (end-to-end) ──────────────────────────────

console.log('\n6. First-run token bootstrap (E2E)')

const helpers = await import('./serve-helpers.mjs')

await check('serve-helpers.mjs exports ensureOperatorToken', () =>
  typeof helpers.ensureOperatorToken === 'function' ? true : 'missing export')

await check('placeholder tokens are rejected', () => {
  for (const bad of ['missing', 'changeme', 'replace-me', 'local-demo-token', '']) {
    if (helpers.isUsableOperatorToken(bad)) return `"${bad}" was accepted`
  }
  return true
})

await check('generated tokens are accepted', () => {
  const good = 'a'.repeat(64)
  return helpers.isUsableOperatorToken(good) ? true : '64-char hex token rejected'
})

await check('ensureOperatorToken creates .env.local with generated token', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ductum-smoke-'))
  const envPath = join(tmpDir, '.env.local')
  try {
    const result = await helpers.ensureOperatorToken({
      env: {},
      envPath,
      generateToken: () => 'abcdef0123456789'.repeat(4),
      input: { on: () => {} },
      output: { write: () => {} },
    })
    if (result.action !== 'generated') return `expected "generated", got "${result.action}"`
    if (!existsSync(envPath)) return '.env.local was not created'
    const written = readFileSync(envPath, 'utf-8')
    if (!written.includes('DUCTUM_OPERATOR_TOKEN=')) return '.env.local missing DUCTUM_OPERATOR_TOKEN line'
    return true
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

await check('ensureOperatorToken reuses existing valid token', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ductum-smoke-'))
  const envPath = join(tmpDir, '.env.local')
  try {
    const result = await helpers.ensureOperatorToken({
      env: { DUCTUM_OPERATOR_TOKEN: 'b'.repeat(64) },
      envPath,
      generateToken: () => { throw new Error('should not generate') },
      input: { on: () => {} },
      output: { write: () => {} },
    })
    if (result.action !== 'existing') return `expected "existing", got "${result.action}"`
    if (result.saved) return 'should not have saved when reusing existing token'
    return true
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

// ── 7. DB-only startup path (no YAML seeding) ───────────────────────────────

console.log('\n7. DB-only startup path')

await check('serve.mjs does not read or seed from ductum.yaml', () => {
  const text = readText('scripts/serve.mjs')
  if (text.includes('ductum.yaml')) return 'serve.mjs still references ductum.yaml'
  if (text.includes('seedFromConfig')) return 'serve.mjs still seeds from config'
  return true
})

await check('serve.mjs requires an initialized Factory DB', () => {
  const text = readText('scripts/serve.mjs')
  return text.includes('inspectFactoryDatabase') ? true : 'serve.mjs does not gate on a Factory record'
})

// ── 8. Legacy seed helper is retired from the happy path ────────────────────

console.log('\n8. Legacy seed helper')

const seedText = readText('scripts/seed.mjs')
const packageJsonText = readText('package.json')
await check('pnpm seed redirects operators to ductum init/start', () => (
  packageJsonText.includes('"seed": "node scripts/seed.mjs --redirect-only"')
    ? true
    : 'package.json still exposes pnpm seed as an active seeding entry point'
))

await check('scripts/seed.mjs is labeled legacy/debug-only', () => (
  seedText.includes('Legacy/debug-only seed script.')
    ? true
    : 'scripts/seed.mjs is missing a legacy/debug-only banner'
))

// ── 9. Onboarding docs exist and reference correct paths ────────────────────

console.log('\n9. Onboarding docs')

await check('docs/SETUP.md exists', () =>
  existsSync(resolve(ROOT, 'docs/SETUP.md')) ? true : 'missing')

await check('docs/CLI_ONBOARDING.md exists', () =>
  existsSync(resolve(ROOT, 'docs/CLI_ONBOARDING.md')) ? true : 'missing')

await check('README.md Quick Start uses pnpm install --frozen-lockfile', () => {
  const text = readText('README.md')
  return text.includes('pnpm install --frozen-lockfile') ? true : 'missing frozen-lockfile'
})

await check('README.md mentions operator token bootstrap', () => {
  const text = readText('README.md')
  return text.includes('DUCTUM_OPERATOR_TOKEN') ? true : 'missing token reference'
})

await check('docs/SETUP.md mentions token auto-generation', () => {
  const text = readText('docs/SETUP.md')
  return text.includes('.env.local') ? true : 'missing .env.local reference'
})

// ── 10. CLI gives actionable error when server is not running ────────────────

console.log('\n10. No-server error handling')

await check('CLI status exits non-zero with no server', () => {
  const err = runMustFail('node packages/cli/dist/index.js status --json --api-url http://127.0.0.1:65530')
  if (err == null) return 'expected non-zero exit code when server is unreachable'
  const stderr = err.stderr ?? ''
  const stdout = err.stdout ?? ''
  const output = stderr + stdout
  if (!output.includes('fetch failed') && !output.includes('ECONNREFUSED')) {
    return `expected fetch error, got: ${output.slice(0, 200)}`
  }
  return true
})

await check('CLI repair exits non-zero with no server', () => {
  const err = runMustFail('node packages/cli/dist/index.js repair --json --api-url http://127.0.0.1:65530')
  if (err == null) return 'expected non-zero exit code when server is unreachable'
  const stderr = err.stderr ?? ''
  const stdout = err.stdout ?? ''
  const output = stderr + stdout
  if (!output.includes('fetch failed') && !output.includes('ECONNREFUSED')) {
    return `expected fetch error, got: ${output.slice(0, 200)}`
  }
  return true
})

await check('CLI doctor --json exits non-zero with no server', () => {
  const err = runMustFail('node packages/cli/dist/index.js doctor --json --api-url http://127.0.0.1:65530')
  if (err == null) return 'expected non-zero exit code when server is unreachable'
  const stderr = err.stderr ?? ''
  const stdout = err.stdout ?? ''
  const output = stderr + stdout
  if (!output.includes('fetch failed') && !output.includes('ECONNREFUSED')) {
    return `expected fetch error, got: ${output.slice(0, 200)}`
  }
  return true
})

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50))
console.log(`Results: ${passed} passed, ${failed} failed`)

if (failed > 0) {
  console.log('\nBLOCKER: Fix the failing checks before this smoke passes.')
  console.log('Missing real credentials (ANTHROPIC_API_KEY, codex login) fail with explicit next commands.')
  process.exit(1)
}

console.log('\nClean container onboarding smoke PASSED.')
console.log('Next: ductum start --no-browser → ductum doctor --json → ductum repair → ductum status')
process.exit(0)

} // end main

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})

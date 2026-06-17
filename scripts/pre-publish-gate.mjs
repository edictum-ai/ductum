#!/usr/bin/env node

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { formatDependencyPolicyFailures, runDependencyPolicy } from './dependency-policy.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages/ductum')
const MAX_TARBALL_BYTES = 30 * 1024 * 1024
const MODE = parseMode(process.argv[2] ?? process.env.DUCTUM_PRE_PUBLISH_MODE ?? 'publish')
const RUNTIME_WORKSPACE_PACKAGE_DIRS = [
  'packages/api',
  'packages/cli',
  'packages/core',
  'packages/harness',
  'packages/mcp',
]
const RUNTIME_DEP_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies']

const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /credentials?\.json$/i,
  /(^|\/)tokens?\.(json|txt|env|ya?ml)$/i,
]

const SECRET_CONTENT_PATTERN =
  /sk-ant-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{20,}|gh[op]_[A-Za-z0-9_]{20,}|(?:^|\n)\s*(?:export\s+)?(?:ANTHROPIC_[A-Z0-9_]*|TELEGRAM_[A-Z0-9_]*|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|ZAI_API_KEY)\s*=\s*(?!["']?\$\{)[^#\n]{8,}/gm

try {
  const status = gateCleanTree()
  const untracked = gateNoUntrackedFiles()
  if (status !== '' || untracked !== '') {
    // The two checks stay separate for the operator-facing gate number.
    if (status !== '') fail(1, status)
    fail(2, untracked)
  }

  run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: ROOT, gate: 3 })
  run('pnpm', ['rebuild', 'better-sqlite3', 'esbuild'], { cwd: ROOT, gate: 3 })
  gateDependencyPolicy()
  run('pnpm', ['audit', '--audit-level=high'], { cwd: ROOT, gate: 3 })
  run('pnpm', ['build'], { cwd: ROOT, gate: 3 })
  run('pnpm', ['test'], { cwd: ROOT, gate: 3 })
  const postTestStatus = gateCleanTree()
  if (postTestStatus !== '') fail(1, `working tree changed after build/test:\n${postTestStatus}`)
  run('node', ['scripts/build-publish-package.mjs'], { cwd: ROOT, gate: 3 })
  gateNoInternalPackageLeaks()

  const dryRun = packDryRun()
  gateDryRunFileNames(dryRun.files)
  gateFilesArray()
  const packed = packTarball()
  gateTarballContents(packed.tarball)
  const publishDryRun = gatePublishDryRun({ mode: MODE })

  if (packed.sizeBytes > MAX_TARBALL_BYTES) {
    fail(3, `tarball exceeds 30 MB: ${packed.sizeBytes} bytes`)
  }
  pass({
    tarball: packed.tarball,
    fileCount: dryRun.files.length,
    sizeBytes: packed.sizeBytes,
    files: dryRun.files,
    publishDryRun,
  })
} catch (error) {
  if (error?.__gateFailed !== true) {
    console.log(JSON.stringify({
      kind: 'publish.gate.failed',
      data: { gate: 0, details: error instanceof Error ? error.message : String(error) },
    }))
  }
  process.exitCode = 1
}

function gateCleanTree() {
  return run('git', ['status', '--porcelain'], { cwd: ROOT, gate: 1 }).stdout.trim()
}

function gateNoUntrackedFiles() {
  return run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, gate: 2 }).stdout.trim()
}

function gateDependencyPolicy() {
  const failures = runDependencyPolicy()
  if (failures.length > 0) fail(3, formatDependencyPolicyFailures(failures))
}

function packDryRun() {
  const output = run('npm', ['pack', '--dry-run', '--json'], { cwd: PACKAGE_DIR, gate: 3 }).stdout
  const parsed = JSON.parse(output)
  const entry = parsed[0]
  const files = entry.files.map((file) => file.path)
  return { files }
}

function gateDryRunFileNames(files) {
  const blocked = files.filter((file) => SECRET_PATH_PATTERNS.some((pattern) => pattern.test(file)))
  if (blocked.length > 0) fail(3, `blocked files in dry-run pack list: ${blocked.join(', ')}`)
}

function gateFilesArray() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) fail(5, 'package.json files array is missing or empty')
  const blocked = pkg.files.filter((item) => item === '*' || item === '.' || item.includes('**'))
  if (blocked.length > 0) fail(5, `package.json files array is not explicit: ${blocked.join(', ')}`)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(pkg[section] ?? {})) {
      if (String(version).startsWith('^') || String(version).startsWith('~')) {
        fail(5, `${section}.${name} must be exact-pinned, got ${version}`)
      }
    }
  }
  gateRuntimeDependencyParity(pkg)
}

function gateRuntimeDependencyParity(publishedPkg) {
  const publishedDeps = publishedPkg.dependencies ?? {}
  const mismatches = []
  for (const packageDir of RUNTIME_WORKSPACE_PACKAGE_DIRS) {
    const workspacePkg = JSON.parse(readFileSync(join(ROOT, packageDir, 'package.json'), 'utf8'))
    for (const section of RUNTIME_DEP_SECTIONS) {
      for (const [name, version] of Object.entries(workspacePkg[section] ?? {})) {
        if (String(version).startsWith('workspace:')) continue
        const published = publishedDeps[name]
        if (published == null) {
          mismatches.push(`${packageDir} ${section}.${name}=${version} missing from packages/ductum/package.json`)
        } else if (published !== version) {
          mismatches.push(`${packageDir} ${section}.${name} workspace=${version} published=${published}`)
        }
      }
    }
  }
  if (mismatches.length > 0) fail(5, `published dependency parity failed:\n${mismatches.join('\n')}`)
}

function gateNoInternalPackageLeaks() {
  const hits = []
  for (const file of walk(join(PACKAGE_DIR, 'dist'))) {
    if (!file.endsWith('.js')) continue
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    const text = buffer.toString('utf8')
    if (hasUnresolvedInternalImport(text)) {
      hits.push(file.slice(PACKAGE_DIR.length + 1))
    }
  }
  if (hits.length > 0) fail(3, `unresolved internal package imports in dist: ${hits.join(', ')}`)
}

function hasUnresolvedInternalImport(text) {
  return /from\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']/.test(text) ||
    /import\s*\(\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']\s*\)/.test(text) ||
    /import\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']/.test(text)
}

function packTarball() {
  const outDir = mkdtempSync(join(tmpdir(), 'ductum-publish-'))
  const output = run('npm', ['pack', '--json', '--pack-destination', outDir], { cwd: PACKAGE_DIR, gate: 4 }).stdout
  const entry = JSON.parse(output)[0]
  const tarball = join(outDir, entry.filename)
  return { tarball, sizeBytes: statSync(tarball).size }
}

function gateTarballContents(tarball) {
  const extractDir = mkdtempSync(join(tmpdir(), 'ductum-publish-extract-'))
  run('tar', ['-xzf', tarball, '-C', extractDir], { cwd: ROOT, gate: 4 })
  const hits = []
  for (const file of walk(extractDir)) {
    const rel = file.slice(extractDir.length + 1)
    if (SECRET_PATH_PATTERNS.some((pattern) => pattern.test(rel))) hits.push(`${rel}: blocked path`)
    const buffer = readFileSync(file)
    if (buffer.includes(0)) continue
    const text = buffer.toString('utf8')
    if (SECRET_CONTENT_PATTERN.test(text)) hits.push(`${rel}: secret-like content`)
    SECRET_CONTENT_PATTERN.lastIndex = 0
  }
  rmSync(extractDir, { recursive: true, force: true })
  if (hits.length > 0) fail(4, hits.join('\n'))
}

function gatePublishDryRun({ mode }) {
  const result = runAllowFailure('npm', ['publish', '--dry-run', '--provenance', '--access', 'public'], {
    cwd: PACKAGE_DIR,
    gate: 6,
  })
  if (result.status === 0) return `${result.stdout}${result.stderr}`.trim()

  const output = `${result.stdout}${result.stderr}`.trim()
  if (mode === 'dryrun' && isAlreadyPublishedDryRun(output)) {
    return `${output}\n[dryrun] ductum@${readPublishedPackageVersion()} is already published; publish mode remains strict.`
  }
  fail(6, `npm publish --dry-run --provenance --access public failed\n${output}`.trim())
}

function isAlreadyPublishedDryRun(output) {
  return output.includes(`previously published versions: ${readPublishedPackageVersion()}`)
}

function readPublishedPackageVersion() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
  return pkg.version
}

function parseMode(mode) {
  if (mode === 'dryrun' || mode === 'publish') return mode
  throw new Error(`pre-publish gate mode must be dryrun or publish, got ${mode}`)
}

function runAllowFailure(command, args, { cwd }) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', shell: false })
}

function run(command, args, { cwd, gate }) {
  const result = runAllowFailure(command, args, { cwd })
  if (result.status !== 0) {
    fail(gate, `${command} ${args.join(' ')} failed\n${result.stdout}${result.stderr}`.trim())
  }
  return { stdout: result.stdout, stderr: result.stderr }
}


function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) files.push(...walk(path))
    else if (stat.isFile()) files.push(path)
  }
  return files
}

function pass(data) {
  console.log(JSON.stringify({ kind: 'publish.gate.passed', data }))
}

function fail(gate, details) {
  console.log(JSON.stringify({ kind: 'publish.gate.failed', data: { gate, details } }))
  const error = new Error(details)
  error.__gateFailed = true
  throw error
}

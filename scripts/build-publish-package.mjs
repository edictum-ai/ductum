#!/usr/bin/env node

import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages/ductum')
const DIST = join(PACKAGE_DIR, 'dist')

const workspaces = [
  ['cli', 'packages/cli/dist'],
  ['api', 'packages/api/dist'],
  ['core', 'packages/core/dist'],
  ['harness', 'packages/harness/dist'],
  ['mcp', 'packages/mcp/dist'],
]

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

for (const [name, source] of workspaces) {
  const from = join(ROOT, source)
  if (!existsSync(from)) throw new Error(`missing build output: ${source}`)
  copyRuntimeTree(from, join(DIST, name))
}

copyTree(join(ROOT, 'packages/dashboard/dist'), join(DIST, 'dashboard'))
copyTree(join(ROOT, 'workflows'), join(DIST, 'workflows'))
copyFileSync(join(ROOT, 'LICENSE'), join(PACKAGE_DIR, 'LICENSE'))
writeBin()
rewriteInternalImports()

function writeBin() {
  const path = join(DIST, 'bin/ductum.js')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, [
    '#!/usr/bin/env node',
    "import { runCli } from '../cli/program.js'",
    '',
    'const exitCode = await runCli(process.argv)',
    'if (exitCode !== 0) process.exitCode = exitCode',
    '',
  ].join('\n'))
  chmodSync(path, 0o755)
}

function rewriteInternalImports() {
  for (const file of walk(DIST).filter((item) => item.endsWith('.js'))) {
    let text = readFileSync(file, 'utf8')
    for (const name of ['cli', 'core', 'api', 'harness', 'mcp']) {
      text = rewritePackageSpecifier(text, file, name)
    }
    if (hasUnresolvedInternalImport(text)) {
      throw new Error(`unresolved internal package import in ${relative(ROOT, file)}`)
    }
    writeFileSync(file, text)
  }
}

function rewritePackageSpecifier(text, file, name) {
  return text
    .replaceAll(
      new RegExp(`(from\\s*["'])@ductum/${name}([^"']*)(["'])`, 'g'),
      (_match, prefix, subpath, suffix) => `${prefix}${relativeRuntimeImport(file, name, subpath)}${suffix}`,
    )
    .replaceAll(
      new RegExp(`(import\\s*\\(\\s*["'])@ductum/${name}([^"']*)(["']\\s*\\))`, 'g'),
      (_match, prefix, subpath, suffix) => `${prefix}${relativeRuntimeImport(file, name, subpath)}${suffix}`,
    )
    .replaceAll(
      new RegExp(`(import\\s*["'])@ductum/${name}([^"']*)(["'])`, 'g'),
      (_match, prefix, subpath, suffix) => `${prefix}${relativeRuntimeImport(file, name, subpath)}${suffix}`,
    )
}

function relativeRuntimeImport(file, name, subpath) {
  const suffix = subpath === '' ? 'index.js' : subpath.replace(/^\//, '')
  return relativeImport(dirname(file), join(DIST, name, suffix))
}

function hasUnresolvedInternalImport(text) {
  return /from\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']/.test(text) ||
    /import\s*\(\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']\s*\)/.test(text) ||
    /import\s*["']@ductum\/(cli|core|api|harness|mcp)(\/[^"']*)?["']/.test(text)
}

function copyRuntimeTree(from, to) {
  for (const file of walk(from)) {
    const rel = relative(from, file)
    if (isExcludedRuntimeFile(rel)) continue
    const out = join(to, rel)
    mkdirSync(dirname(out), { recursive: true })
    copyFileSync(file, out)
    if (rel === 'index.js' && to.endsWith(`${sep}cli`)) chmodSync(out, 0o755)
  }
}

function copyTree(from, to) {
  if (!existsSync(from)) throw new Error(`missing required package asset: ${relative(ROOT, from)}`)
  cpSync(from, to, {
    recursive: true,
    filter: (source) => !isExcludedAsset(relative(from, source)),
  })
}

function isExcludedRuntimeFile(rel) {
  const base = rel.split(sep).at(-1) ?? rel
  return rel.split(sep).includes('tests') ||
    base.endsWith('.test.js') ||
    base.endsWith('.test.d.ts') ||
    base.endsWith('.map') ||
    base.endsWith('.ts') ||
    base.endsWith('.d.ts')
}

function isExcludedAsset(rel) {
  const base = rel.split(sep).at(-1) ?? rel
  return base.endsWith('.map') || rel.split(sep).includes('tests')
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

function relativeImport(fromDir, target) {
  let rel = relative(fromDir, target).replaceAll(sep, '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  return rel
}

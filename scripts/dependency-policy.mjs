#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages/ductum')
const PACKAGE_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

export const TRUSTED_BUILT_DEPENDENCIES = ['better-sqlite3', 'esbuild']

export const DASHBOARD_ONLY_DEPENDENCIES = [
  '@dagrejs/dagre',
  '@fontsource-variable/geist',
  '@fontsource-variable/jetbrains-mono',
  '@tailwindcss/vite',
  '@tanstack/react-query',
  '@testing-library/jest-dom',
  '@testing-library/react',
  '@types/react',
  '@types/react-dom',
  '@vitejs/plugin-react',
  '@xyflow/react',
  'class-variance-authority',
  'clsx',
  'jsdom',
  'lucide-react',
  'radix-ui',
  'react',
  'react-dom',
  'react-router',
  'react-router-dom',
  'shadcn',
  'tailwind-merge',
  'tailwindcss',
  'tw-animate-css',
  'vite',
]

export const UNKNOWN_LICENSE_ALLOWLIST = []

export function runDependencyPolicy({
  root = ROOT,
  publishedPackagePath = join(PACKAGE_DIR, 'package.json'),
  unknownLicenseAllowlist = UNKNOWN_LICENSE_ALLOWLIST,
} = {}) {
  const rootPackage = readJson(join(root, 'package.json'))
  const publishedPackage = readJson(publishedPackagePath)
  return [
    ...validateOnlyBuiltDependencies(rootPackage),
    ...findDashboardOnlyPublishedDeps(publishedPackage),
    ...findUnknownLicensePackages(root, unknownLicenseAllowlist),
  ]
}

export function validateOnlyBuiltDependencies(rootPackage) {
  const actual = rootPackage.pnpm?.onlyBuiltDependencies
  if (!Array.isArray(actual)) return ['pnpm.onlyBuiltDependencies must be present']
  if (JSON.stringify(actual) === JSON.stringify(TRUSTED_BUILT_DEPENDENCIES)) return []
  return [`pnpm.onlyBuiltDependencies must be ${TRUSTED_BUILT_DEPENDENCIES.join(', ')}`]
}

export function findDashboardOnlyPublishedDeps(publishedPackage) {
  const dashboardOnly = new Set(DASHBOARD_ONLY_DEPENDENCIES)
  const hits = []
  for (const section of PACKAGE_SECTIONS) {
    for (const name of Object.keys(publishedPackage[section] ?? {})) {
      if (dashboardOnly.has(name)) hits.push(`${section}.${name}`)
    }
  }
  return hits.map((hit) => `dashboard-only dependency must not ship in packages/ductum: ${hit}`)
}

export function findUnknownLicensePackages(root, allowlist = UNKNOWN_LICENSE_ALLOWLIST) {
  const allowed = new Set(allowlist)
  return readInstalledPackageJsons(root)
    .filter((pkg) => !hasKnownLicense(pkg))
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .filter((key) => !allowed.has(key))
    .map((key) => `installed package has unknown license: ${key}`)
}

export function readInstalledPackageJsons(root) {
  const pnpmDir = join(root, 'node_modules/.pnpm')
  if (!existsSync(pnpmDir)) return []

  const packages = new Map()
  for (const entry of readdirSync(pnpmDir)) {
    const modulesDir = join(pnpmDir, entry, 'node_modules')
    if (!isDirectory(modulesDir)) continue
    for (const packageEntry of readdirSync(modulesDir)) {
      if (packageEntry.startsWith('.')) continue
      if (packageEntry.startsWith('@')) {
        readScopedInstalledPackages(packages, join(modulesDir, packageEntry))
      } else {
        readInstalledPackage(packages, join(modulesDir, packageEntry, 'package.json'))
      }
    }
  }
  return [...packages.values()]
}

export function formatDependencyPolicyFailures(failures) {
  return `dependency policy failed:\n${failures.join('\n')}`
}

function readScopedInstalledPackages(packages, scopeDir) {
  if (!isDirectory(scopeDir)) return
  for (const name of readdirSync(scopeDir)) {
    readInstalledPackage(packages, join(scopeDir, name, 'package.json'))
  }
}

function readInstalledPackage(packages, packageJsonPath) {
  if (!existsSync(packageJsonPath)) return
  const pkg = readJson(packageJsonPath)
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') return
  packages.set(`${pkg.name}@${pkg.version}`, pkg)
}

function hasKnownLicense(pkg) {
  const license = normalizeLicense(pkg.license)
  if (license !== '') return !/^(unknown|unlicensed)$/i.test(license)
  return Array.isArray(pkg.licenses) && pkg.licenses.length > 0
}

function normalizeLicense(license) {
  if (typeof license === 'string') return license.trim()
  if (license != null && typeof license.type === 'string') return license.type.trim()
  return ''
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function main() {
  const failures = runDependencyPolicy()
  if (failures.length === 0) {
    console.log(JSON.stringify({ kind: 'dependency.policy.passed' }))
    return
  }
  console.log(JSON.stringify({ kind: 'dependency.policy.failed', data: { failures } }))
  process.exitCode = 1
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main()

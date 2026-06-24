import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  findDashboardOnlyPublishedDeps,
  findUnknownLicensePackages,
  validateOnlyBuiltDependencies,
} from './dependency-policy.mjs'

describe('dependency policy', () => {
  it('keeps only the accepted native build dependencies enabled', () => {
    expect(validateOnlyBuiltDependencies({
      pnpm: { onlyBuiltDependencies: ['better-sqlite3', 'esbuild'] },
    })).toEqual([])
    expect(validateOnlyBuiltDependencies({
      pnpm: { onlyBuiltDependencies: ['better-sqlite3', 'esbuild', 'extra-native'] },
    })).toEqual([
      'pnpm.onlyBuiltDependencies must be better-sqlite3, esbuild',
    ])
  })

  it('blocks dashboard-only dependencies from the published package manifest', () => {
    expect(findDashboardOnlyPublishedDeps({
      dependencies: {
        react: '19.2.4',
        yaml: '2.8.3',
      },
      devDependencies: {
        vite: '8.0.5',
      },
    })).toEqual([
      'dashboard-only dependency must not ship in packages/ductum: dependencies.react',
      'dashboard-only dependency must not ship in packages/ductum: devDependencies.vite',
    ])
  })

  it('checks licenses only at actual pnpm-installed package roots', () => {
    const root = mkdtempSync(join(tmpdir(), 'ductum-dependency-policy-'))
    try {
      writeInstalledPackage(root, 'known@1.0.0', 'known', {
        name: 'known',
        version: '1.0.0',
        license: 'MIT',
      })
      writeNestedFixturePackage(root, 'known@1.0.0', 'known', {
        name: 'fixture-without-license',
        version: '1.0.0',
      })
      writeInstalledPackage(root, 'unknown@1.0.0', 'unknown', {
        name: 'unknown',
        version: '1.0.0',
      })

      expect(findUnknownLicensePackages(root)).toEqual([
        'installed package has unknown license: unknown@1.0.0',
      ])
      expect(findUnknownLicensePackages(root, ['unknown@1.0.0'])).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function writeInstalledPackage(root, storeEntry, packageName, pkg) {
  const packageDir = join(root, 'node_modules/.pnpm', storeEntry, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(pkg))
}

function writeNestedFixturePackage(root, storeEntry, packageName, pkg) {
  const packageDir = join(
    root,
    'node_modules/.pnpm',
    storeEntry,
    'node_modules',
    packageName,
    'example',
  )
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify(pkg))
}

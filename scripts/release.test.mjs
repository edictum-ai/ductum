import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  assertTagMatchesPackageVersion,
  assertTrustedPublishingContext,
  buildReleasePlan,
} from './release.mjs'
import {
  findDashboardOnlyPublishedDeps,
  findUnknownLicensePackages,
  validateOnlyBuiltDependencies,
} from './dependency-policy.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const RELEASE_WORKFLOW_PATH = resolve(ROOT, '.github/workflows/release.yml')
const CI_WORKFLOW_PATH = resolve(ROOT, '.github/workflows/ci.yml')

describe('release workflow hardening', () => {
  it('exists and never references npm token auth', () => {
    const text = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')

    expect(text).not.toContain('NPM_TOKEN')
    expect(text).not.toContain('NODE_AUTH_TOKEN')
  })

  it('runs only on manual dispatch and semver-ish tag pushes', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)

    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(workflow.on.push.tags).toEqual(['v*'])
    expect(workflow.on.pull_request).toBeUndefined()
    expect(workflow.on.pull_request_target).toBeUndefined()
  })

  it('grants only read contents and OIDC id-token permissions', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)

    expect(workflow.permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
    })
  })

  it('passes repository visibility into the publish script', () => {
    const text = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')

    expect(text).toContain('DUCTUM_RELEASE_PROVENANCE')
    expect(text).toContain('github.event.repository.private == false')
  })

  it('uses Node 24 so Homebrew native artifacts match the formula runtime', () => {
    const text = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')

    expect(text).toContain('node-version: 24.5.0')
  })

  it('keeps third-party actions SHA-pinned', () => {
    const text = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')
    const actionRefs = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1])

    expect(actionRefs).toEqual(expect.arrayContaining([
      'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683',
      'pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda',
      'actions/setup-node@39370e3970a6d050c480ffad4ff0ed4d3fdee5af',
    ]))
    for (const ref of actionRefs) {
      expect(ref).toMatch(/@[a-f0-9]{40}$/)
    }
  })

  it('keeps CI read-only and avoids pull_request_target', () => {
    const workflow = readWorkflow(CI_WORKFLOW_PATH)
    const text = readFileSync(CI_WORKFLOW_PATH, 'utf8')

    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.on.pull_request_target).toBeUndefined()
    expect(text).not.toMatch(/\bsecrets\./)
  })
})

describe('release script safety', () => {
  it('keeps dry-run publish-free and OIDC-free', () => {
    const plan = buildReleasePlan({
      mode: 'dryrun',
      env: {},
      packageVersion: '0.1.1',
    })

    expect(plan.publish).toBe(false)
    expect(plan.commands).toEqual([
      expect.objectContaining({
        command: 'node',
        args: ['scripts/pre-publish-gate.mjs', 'dryrun'],
      }),
      expect.objectContaining({
        command: 'node',
        args: ['scripts/build-homebrew-artifact.mjs'],
      }),
    ])
    expect(plan.commands.some((command) => command.command === 'npm')).toBe(false)
  })

  it('runs the strict pre-publish gate in publish mode', () => {
    const plan = buildReleasePlan({
      mode: 'publish',
      env: trustedTagEnv(),
      packageVersion: '0.1.1',
    })

    expect(plan.commands.at(0)).toEqual(expect.objectContaining({
      command: 'node',
      args: ['scripts/pre-publish-gate.mjs', 'publish'],
    }))
    expect(plan.commands.at(1)).toEqual(expect.objectContaining({
      command: 'node',
      args: ['scripts/build-homebrew-artifact.mjs'],
    }))
  })

  it('refuses CI publish without GitHub Actions OIDC', () => {
    expect(() =>
      buildReleasePlan({
        mode: 'publish',
        env: { GITHUB_ACTIONS: 'true' },
        packageVersion: '0.1.1',
      }),
    ).toThrow('OIDC')
  })

  it('refuses token-backed publish env vars', () => {
    expect(() =>
      assertTrustedPublishingContext({
        env: trustedTagEnv({ NPM_TOKEN: 'secret' }),
        packageVersion: '0.1.1',
      }),
    ).toThrow('token')
  })

  it('publishes with provenance by default', () => {
    const plan = buildReleasePlan({
      mode: 'publish',
      env: trustedTagEnv(),
      packageVersion: '0.1.1',
    })

    expect(plan.commands.at(-1)).toEqual(expect.objectContaining({
      command: 'npm',
      args: ['publish', '--provenance', '--access', 'public'],
    }))
  })

  it('keeps trusted publishing but omits provenance for private repository releases', () => {
    const plan = buildReleasePlan({
      mode: 'publish',
      env: trustedTagEnv({ DUCTUM_RELEASE_PROVENANCE: 'false' }),
      packageVersion: '0.1.1',
    })

    expect(plan.commands.at(-1)).toEqual(expect.objectContaining({
      command: 'npm',
      args: ['publish', '--access', 'public'],
    }))
  })

  it('requires release tags to match packages/ductum version', () => {
    expect(() => assertTagMatchesPackageVersion('v0.1.1', '0.1.1')).not.toThrow()
    expect(() => assertTagMatchesPackageVersion('v0.1.2', '0.1.1')).toThrow('does not match')
    expect(() => assertTagMatchesPackageVersion('not-a-tag', '0.1.1')).toThrow('not semver')
  })

  it('refuses manual dispatch publishes outside main', () => {
    expect(() =>
      assertTrustedPublishingContext({
        env: trustedDispatchEnv({ GITHUB_REF_NAME: 'release-test' }),
        packageVersion: '0.1.1',
      }),
    ).toThrow('outside main')
  })
})

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

function readWorkflow(path) {
  return parse(readFileSync(path, 'utf8'))
}

function trustedTagEnv(overrides = {}) {
  return {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_REF_NAME: 'v0.1.1',
    GITHUB_REF_TYPE: 'tag',
    GITHUB_REPOSITORY: 'edictum-ai/ductum',
    GITHUB_WORKFLOW_REF: 'edictum-ai/ductum/.github/workflows/release.yml@refs/tags/v0.1.1',
    ...overrides,
  }
}

function trustedDispatchEnv(overrides = {}) {
  return {
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'token',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com',
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF_NAME: 'main',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REPOSITORY: 'edictum-ai/ductum',
    GITHUB_WORKFLOW_REF: 'edictum-ai/ductum/.github/workflows/release.yml@refs/heads/main',
    ...overrides,
  }
}

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

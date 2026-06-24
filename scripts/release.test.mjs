import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import {
  assertTagMatchesPackageVersion,
  assertTrustedPublishingContext,
  buildReleasePlan,
} from './release.mjs'

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

  it('keeps top-level permissions read-only', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)

    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('grants OIDC id-token only to the npm publish job, without contents write', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)

    expect(workflow.jobs['publish-npm'].permissions).toEqual({
      contents: 'read',
      'id-token': 'write',
    })
  })

  it('limits contents write to the release-asset jobs only', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)

    expect(workflow.jobs['create-release'].permissions).toEqual({ contents: 'write' })
    expect(workflow.jobs['homebrew-release'].permissions).toEqual({ contents: 'write' })
    expect(workflow.jobs['create-release']).not.toHaveProperty('permissions.id-token')
  })

  it('builds Homebrew artifacts for every supported platform on a tag', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)
    const release = workflow.jobs['homebrew-release']

    expect(release.if).toContain("github.ref_type == 'tag'")
    expect(release.needs).toBe('create-release')
    const platforms = release.strategy.matrix.include.map((leg) => leg.platform).sort()
    expect(platforms).toEqual(['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64'])
  })

  it('publishes the tap with read-only GITHUB_TOKEN and an explicit cross-repo secret', () => {
    const workflow = readWorkflow(RELEASE_WORKFLOW_PATH)
    const tap = workflow.jobs['publish-tap']
    const text = readFileSync(RELEASE_WORKFLOW_PATH, 'utf8')

    expect(tap.permissions).toEqual({ contents: 'read' })
    expect(tap.needs).toBe('homebrew-release')
    expect(text).toContain('HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}')
    expect(text).toContain('node scripts/publish-homebrew-tap.mjs publish')
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
  it('keeps dry-run publish-free, OIDC-free, and previews the tap publication', () => {
    const plan = buildReleasePlan({
      mode: 'dryrun',
      env: {},
      packageVersion: '0.1.1',
      outDir: '/tmp/ductum-release-test',
    })

    expect(plan.publish).toBe(false)
    expect(plan.commands).toEqual([
      expect.objectContaining({
        command: 'node',
        args: ['scripts/pre-publish-gate.mjs', 'dryrun'],
      }),
      expect.objectContaining({
        command: 'node',
        args: ['scripts/build-homebrew-artifact.mjs', '--out-dir', '/tmp/ductum-release-test'],
      }),
      expect.objectContaining({
        command: 'node',
        args: ['scripts/publish-homebrew-tap.mjs', 'dryrun', '--out-dir', '/tmp/ductum-release-test'],
      }),
    ])
    expect(plan.commands.some((command) => command.command === 'npm')).toBe(false)
  })

  it('runs the strict pre-publish gate in publish mode', () => {
    const plan = buildReleasePlan({
      mode: 'publish',
      env: trustedTagEnv(),
      packageVersion: '0.1.1',
      outDir: '/tmp/ductum-release-test',
    })

    expect(plan.commands.at(0)).toEqual(expect.objectContaining({
      command: 'node',
      args: ['scripts/pre-publish-gate.mjs', 'publish'],
    }))
    expect(plan.commands.at(1)).toEqual(expect.objectContaining({
      command: 'node',
      args: ['scripts/build-homebrew-artifact.mjs', '--out-dir', '/tmp/ductum-release-test'],
    }))
  })

  it('does not publish the tap from the npm release plan', () => {
    const plan = buildReleasePlan({
      mode: 'publish',
      env: trustedTagEnv(),
      packageVersion: '0.1.1',
      outDir: '/tmp/ductum-release-test',
    })

    expect(plan.commands.some((command) => command.args.includes('publish-homebrew-tap.mjs'))).toBe(false)
  })

  it('refuses CI publish without GitHub Actions OIDC', () => {
    expect(() =>
      buildReleasePlan({
        mode: 'publish',
        env: { GITHUB_ACTIONS: 'true' },
        packageVersion: '0.1.1',
        outDir: '/tmp/ductum-release-test',
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
      outDir: '/tmp/ductum-release-test',
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
      outDir: '/tmp/ductum-release-test',
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

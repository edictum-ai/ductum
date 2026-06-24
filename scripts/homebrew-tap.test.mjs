import { describe, expect, it } from 'vitest'

import {
  PLACEHOLDER_SHA256,
  PLATFORMS,
  assertNoPlaceholderChecksums,
  generateTapFormula,
  releaseDownloadUrl,
} from './homebrew-formula.mjs'
import {
  DEFAULT_TAP_REPO,
  assertCompleteManifest,
  buildTapDownloads,
  buildTapPublishPlan,
  formatChecksumLine,
  missingManifestPlatforms,
  parseChecksumManifest,
  resolveTapCredentials,
  tapBranchName,
  tapCommitMessage,
  tapPullRequestTitle,
} from './homebrew-tap.mjs'

const REAL = 'a'.repeat(64)
const REAL_B = 'b'.repeat(64)

function completeChecksums() {
  return Object.fromEntries(PLATFORMS.map((platform, index) => [
    platform.key,
    String.fromCharCode(97 + index).repeat(64),
  ]))
}

describe('placeholder checksum rejection', () => {
  it('FAILS to generate a tap formula when any platform checksum is a placeholder', () => {
    const downloads = Object.fromEntries(PLATFORMS.map((platform) => [
      platform.key,
      {
        url: releaseDownloadUrl({ version: '0.1.3', platformKey: platform.key }),
        sha256: platform.key === 'linux_arm64' ? PLACEHOLDER_SHA256 : REAL,
      },
    ]))

    expect(() => generateTapFormula({ version: '0.1.3', downloads })).toThrow('placeholder checksums')
    expect(() => generateTapFormula({ version: '0.1.3', downloads })).toThrow('linux_arm64')
  })

  it('lists every placeholder platform in the failure', () => {
    const downloads = Object.fromEntries(PLATFORMS.map((platform) => [
      platform.key,
      { url: releaseDownloadUrl({ version: '0.1.3', platformKey: platform.key }), sha256: PLACEHOLDER_SHA256 },
    ]))
    expect(() => assertNoPlaceholderChecksums(downloads))
      .toThrow('darwin_amd64, darwin_arm64, linux_amd64, linux_arm64')
  })

  it('emits a real tap formula once every checksum is genuine', () => {
    const downloads = buildTapDownloads({ version: '0.1.3', checksums: completeChecksums() })
    const formula = generateTapFormula({ version: '0.1.3', downloads })

    expect(formula).toContain('class Ductum < Formula')
    expect(formula).not.toContain(PLACEHOLDER_SHA256)
    for (const platform of PLATFORMS) {
      expect(formula).toContain(`ductum_0.1.3_${platform.key}.tar.gz`)
    }
  })
})

describe('checksum manifest parsing', () => {
  it('parses shasum-format lines and derives version + platform', () => {
    const text = [
      formatChecksumLine({ version: '0.1.3', platformKey: 'darwin_arm64', sha256: REAL }),
      formatChecksumLine({ version: '0.1.3', platformKey: 'linux_amd64', sha256: REAL_B }),
    ].join('\n')

    expect(parseChecksumManifest(text)).toEqual({
      version: '0.1.3',
      checksums: { darwin_arm64: REAL, linux_amd64: REAL_B },
    })
  })

  it('rejects unparseable lines, unknown platforms, and mixed versions', () => {
    expect(() => parseChecksumManifest('not-a-checksum-line')).toThrow('unparseable')
    expect(() => parseChecksumManifest(`${REAL}  qratum_0.1.3_darwin_arm64.tar.gz`)).toThrow('unexpected artifact filename')
    expect(() => parseChecksumManifest(`${REAL}  ductum_0.1.3_solaris.tar.gz`)).toThrow('unknown platform in manifest')
    expect(() => parseChecksumManifest([
      `${REAL}  ductum_0.1.3_darwin_arm64.tar.gz`,
      `${REAL_B}  ductum_0.1.4_linux_amd64.tar.gz`,
    ].join('\n'))).toThrow('mixes versions')
    expect(() => parseChecksumManifest('   \n# comment only')).toThrow('empty')
  })
})

describe('manifest completeness', () => {
  it('reports and rejects missing platforms', () => {
    const partial = { darwin_arm64: REAL }
    expect(missingManifestPlatforms(partial).sort())
      .toEqual(['darwin_amd64', 'linux_amd64', 'linux_arm64'])
    expect(() => assertCompleteManifest(partial)).toThrow('incomplete checksum manifest')
    expect(() => buildTapDownloads({ version: '0.1.3', checksums: partial })).toThrow('linux_arm64')
  })

  it('accepts a complete manifest', () => {
    const downloads = buildTapDownloads({ version: '0.1.3', checksums: completeChecksums() })
    expect(Object.keys(downloads).sort()).toEqual(PLATFORMS.map((p) => p.key).sort())
    expect(downloads.linux_arm64.url)
      .toBe('https://github.com/edictum-ai/ductum/releases/download/v0.1.3/ductum_0.1.3_linux_arm64.tar.gz')
  })
})

describe('cross-repo credential gate', () => {
  it('blocks loudly when HOMEBREW_TAP_TOKEN is missing', () => {
    expect(() => resolveTapCredentials({})).toThrow('HOMEBREW_TAP_TOKEN is not configured')
    expect(() => resolveTapCredentials({ HOMEBREW_TAP_TOKEN: '   ' })).toThrow('blocked')
  })

  it('does not accept GITHUB_TOKEN or ambient gh auth as a substitute', () => {
    expect(() => resolveTapCredentials({ GITHUB_TOKEN: 'ghs_workflowtoken' })).toThrow('not accepted')
  })

  it('resolves the explicit token and tap target', () => {
    expect(resolveTapCredentials({ HOMEBREW_TAP_TOKEN: 'app-token' })).toEqual({
      token: 'app-token',
      repo: DEFAULT_TAP_REPO,
      baseBranch: 'main',
    })
    expect(resolveTapCredentials({
      HOMEBREW_TAP_TOKEN: 'app-token',
      HOMEBREW_TAP_REPO: 'edictum-ai/homebrew-test',
      HOMEBREW_TAP_BASE_BRANCH: 'release',
    })).toEqual({ token: 'app-token', repo: 'edictum-ai/homebrew-test', baseBranch: 'release' })
  })
})

describe('tap publish plan', () => {
  it('uses conventional branch and commit metadata for tap PRs', () => {
    expect(tapBranchName('0.1.3')).toBe('chore/ductum-homebrew-0.1.3')
    expect(tapCommitMessage('0.1.3')).toBe('chore(distribution): publish ductum Homebrew formula 0.1.3')
    expect(tapPullRequestTitle('0.1.3')).toBe('chore(distribution): publish ductum Homebrew formula 0.1.3')
  })

  it('dry-run produces a draft preview with placeholders and never pushes', () => {
    const plan = buildTapPublishPlan({
      mode: 'dryrun',
      env: {},
      version: '0.1.3',
      checksums: { darwin_arm64: REAL },
    })

    expect(plan.push).toBe(false)
    expect(plan.draft).toBe(true)
    expect(plan.tapRepo).toBe(DEFAULT_TAP_REPO)
    expect(plan.branch).toBe(tapBranchName('0.1.3'))
    expect(plan.pullRequestTitle).toBe('chore(distribution): publish ductum Homebrew formula 0.1.3')
    expect(plan.missingPlatforms.sort()).toEqual(['darwin_amd64', 'linux_amd64', 'linux_arm64'])
    expect(plan.formula).toContain(PLACEHOLDER_SHA256)
  })

  it('publish requires configured credentials', () => {
    expect(() => buildTapPublishPlan({
      mode: 'publish',
      env: {},
      version: '0.1.3',
      checksums: completeChecksums(),
    })).toThrow('HOMEBREW_TAP_TOKEN')
  })

  it('publish requires a complete, placeholder-free manifest', () => {
    expect(() => buildTapPublishPlan({
      mode: 'publish',
      env: { HOMEBREW_TAP_TOKEN: 'app-token' },
      version: '0.1.3',
      checksums: { darwin_arm64: REAL },
    })).toThrow('incomplete checksum manifest')

    const placeholders = Object.fromEntries(PLATFORMS.map((p) => [p.key, PLACEHOLDER_SHA256]))
    expect(() => buildTapPublishPlan({
      mode: 'publish',
      env: { HOMEBREW_TAP_TOKEN: 'app-token' },
      version: '0.1.3',
      checksums: placeholders,
    })).toThrow(/incomplete checksum manifest|placeholder/)
  })

  it('publish with credentials and a complete manifest yields a real, pushable plan', () => {
    const plan = buildTapPublishPlan({
      mode: 'publish',
      env: { HOMEBREW_TAP_TOKEN: 'app-token' },
      version: '0.1.3',
      checksums: completeChecksums(),
    })

    expect(plan.push).toBe(true)
    expect(plan.draft).toBe(false)
    expect(plan.formula).not.toContain(PLACEHOLDER_SHA256)
    expect(plan.formula).toContain('class Ductum < Formula')
  })
})

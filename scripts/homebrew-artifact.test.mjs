import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { assertNode24Runtime, assertOutsideRepo, buildDownloadsMap, resolveOutDir } from './build-homebrew-artifact.mjs'
import {
  PLACEHOLDER_SHA256,
  PLATFORMS,
  artifactName,
  currentPlatformKey,
  generateFormula,
  releaseDownloadUrl,
} from './homebrew-formula.mjs'

const ROOT = resolve(new URL('..', import.meta.url).pathname)

describe('Homebrew artifact helpers', () => {
  it('refuses to write release outputs inside the repo checkout', () => {
    expect(() => assertOutsideRepo(ROOT)).toThrow('inside the repo')
    expect(() => assertOutsideRepo(join(ROOT, 'tmp-homebrew'))).toThrow('inside the repo')
  })

  it('uses an external output directory by default and accepts external explicit dirs', () => {
    const implicit = resolveOutDir()
    const explicit = mkdtempSync(join(tmpdir(), 'ductum-homebrew-test-'))
    try {
      expect(implicit.startsWith(ROOT)).toBe(false)
      expect(resolveOutDir(explicit)).toBe(explicit)
      expect(() => {
        const nested = join(explicit, 'nested')
        mkdirSync(nested)
        return resolveOutDir(nested)
      }).not.toThrow()
    } finally {
      rmSync(implicit, { recursive: true, force: true })
      rmSync(explicit, { recursive: true, force: true })
    }
  })

  it('names platform tarballs and release URLs deterministically', () => {
    expect(currentPlatformKey('darwin', 'arm64')).toBe('darwin_arm64')
    expect(artifactName('0.1.3', 'linux_amd64')).toBe('ductum_0.1.3_linux_amd64.tar.gz')
    expect(releaseDownloadUrl({ version: '0.1.3', platformKey: 'linux_amd64' }))
      .toBe('https://github.com/edictum-ai/ductum/releases/download/v0.1.3/ductum_0.1.3_linux_amd64.tar.gz')
  })

  it('renders a Homebrew formula with node@24, libexec install, bin wrapper, and checksums', () => {
    const downloads = Object.fromEntries(PLATFORMS.map((platform) => [
      platform.key,
      {
        url: releaseDownloadUrl({ version: '0.1.3', platformKey: platform.key }),
        sha256: PLACEHOLDER_SHA256,
      },
    ]))
    const formula = generateFormula({ version: '0.1.3', downloads })

    expect(formula).toContain('class Ductum < Formula')
    expect(formula).toContain('depends_on "node@24"')
    expect(formula).toContain('libexec.install Dir["*"]')
    expect(formula).toContain('(bin/"ductum").write <<~SH')
    expect(formula).toContain('Formula["node@24"].opt_bin')
    expect(formula).toContain('assert_match version.to_s, shell_output("#{bin}/ductum --version")')
    for (const platform of PLATFORMS) {
      expect(formula).toContain(`ductum_0.1.3_${platform.key}.tar.gz`)
      expect(formula).toContain(`sha256 "${PLACEHOLDER_SHA256}"`)
    }
  })

  it('can render a local formula URL for the current platform smoke install', () => {
    const tarball = join(tmpdir(), 'ductum_0.1.3_darwin_arm64.tar.gz')
    const downloads = buildDownloadsMap({
      version: '0.1.3',
      platformKey: 'darwin_arm64',
      sha256: 'a'.repeat(64),
      tarball,
      localFormula: true,
    })

    expect(downloads.darwin_arm64).toEqual({
      url: `file://${tarball}`,
      sha256: 'a'.repeat(64),
    })
    expect(downloads.linux_amd64.url)
      .toBe('https://github.com/edictum-ai/ductum/releases/download/v0.1.3/ductum_0.1.3_linux_amd64.tar.gz')
    expect(downloads.linux_amd64.sha256).toBe(PLACEHOLDER_SHA256)
  })

  it('rejects runtime Node versions that do not match the formula dependency major', () => {
    expect(() => assertNode24Runtime('24.17.0', '/opt/homebrew/opt/node@24/bin/node')).not.toThrow()
    expect(() => assertNode24Runtime('25.8.2', '/opt/homebrew/opt/node@24/bin/node'))
      .toThrow('reported 25.8.2')
  })
})

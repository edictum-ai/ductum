// Pure helpers for the Ductum Homebrew release artifact and formula.

export const DEFAULT_RELEASE_REPO = 'edictum-ai/ductum'
export const DEFAULT_HOMEPAGE = 'https://github.com/edictum-ai/ductum'
export const DEFAULT_DESC = 'Ductum factory control plane CLI'
export const DEFAULT_LICENSE = 'MIT'
export const NODE_DEPENDENCY = 'node@24'

export const PLATFORMS = [
  { key: 'darwin_amd64', nodePlatform: 'darwin', nodeArch: 'x64', macro: ['on_macos', 'on_intel'] },
  { key: 'darwin_arm64', nodePlatform: 'darwin', nodeArch: 'arm64', macro: ['on_macos', 'on_arm'] },
  { key: 'linux_amd64', nodePlatform: 'linux', nodeArch: 'x64', macro: ['on_linux', 'on_intel'] },
  { key: 'linux_arm64', nodePlatform: 'linux', nodeArch: 'arm64', macro: ['on_linux', 'on_arm'] },
]

export const PLACEHOLDER_SHA256 = 'f'.repeat(64)

export function currentPlatformKey(nodePlatform = process.platform, nodeArch = process.arch) {
  const match = PLATFORMS.find((platform) => platform.nodePlatform === nodePlatform && platform.nodeArch === nodeArch)
  if (match == null) throw new Error(`unsupported Homebrew target: ${nodePlatform}/${nodeArch}`)
  return match.key
}

export function artifactName(version, platformKey) {
  assertVersion(version)
  assertPlatformKey(platformKey)
  return `ductum_${version}_${platformKey}.tar.gz`
}

export function releaseDownloadUrl({ repo = DEFAULT_RELEASE_REPO, version, platformKey }) {
  assertVersion(version)
  return `https://github.com/${repo}/releases/download/v${version}/${artifactName(version, platformKey)}`
}

export function isValidSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

export function isPlaceholderSha256(value) {
  return value === PLACEHOLDER_SHA256
}

// A published tap formula must carry real per-platform checksums. The local
// single-platform builder leaves PLACEHOLDER_SHA256 for platforms it did not
// build; publishing such a formula would point Homebrew at unverifiable
// downloads. This guard makes that a loud failure instead of a silent ship.
export function assertNoPlaceholderChecksums(downloads) {
  const source = downloads instanceof Map ? Object.fromEntries(downloads) : (downloads ?? {})
  const placeholders = []
  for (const platform of PLATFORMS) {
    const entry = source[platform.key]
    if (entry != null && isPlaceholderSha256(entry.sha256)) placeholders.push(platform.key)
  }
  if (placeholders.length > 0) {
    throw new Error(`refusing to publish tap formula with placeholder checksums for: ${placeholders.join(', ')}`)
  }
}

// generateFormula is reused for local drafts (placeholders allowed). The tap
// publication path must go through generateTapFormula so placeholder checksums
// can never reach the public tap.
export function generateTapFormula(options) {
  assertNoPlaceholderChecksums(options?.downloads)
  return generateFormula(options)
}

export function generateFormula({
  version,
  downloads,
  desc = DEFAULT_DESC,
  homepage = DEFAULT_HOMEPAGE,
  license = DEFAULT_LICENSE,
}) {
  assertVersion(version)
  const entries = normalizeDownloads(downloads)

  return [
    'class Ductum < Formula',
    `  desc "${desc}"`,
    `  homepage "${homepage}"`,
    `  version "${version}"`,
    `  license "${license}"`,
    '',
    `  depends_on "${NODE_DEPENDENCY}"`,
    '',
    ...renderOsBlock('on_macos', ['darwin_amd64', 'darwin_arm64'], entries),
    '',
    ...renderOsBlock('on_linux', ['linux_amd64', 'linux_arm64'], entries),
    '',
    '  def install',
    '    libexec.install Dir["*"]',
    '    (bin/"ductum").write <<~SH',
    '      #!/bin/bash',
    '      exec "#{Formula["node@24"].opt_bin}/node" "#{libexec}/dist/bin/ductum.js" "$@"',
    '    SH',
    '    (bin/"ductum").chmod 0755',
    '  end',
    '',
    '  test do',
    '    assert_match version.to_s, shell_output("#{bin}/ductum --version")',
    '  end',
    'end',
    '',
  ].join('\n')
}

function renderOsBlock(osMacro, platformKeys, entries) {
  const inner = []
  for (const key of platformKeys) {
    const platform = PLATFORMS.find((candidate) => candidate.key === key)
    const archMacro = platform.macro[1]
    const entry = entries[key]
    inner.push(
      `    ${archMacro} do`,
      `      url "${entry.url}"`,
      `      sha256 "${entry.sha256}"`,
      '    end',
    )
  }
  return [`  ${osMacro} do`, ...inner, '  end']
}

function normalizeDownloads(downloads) {
  const source = downloads instanceof Map ? Object.fromEntries(downloads) : (downloads ?? {})
  const normalized = {}
  for (const platform of PLATFORMS) {
    const entry = source[platform.key]
    if (entry == null || typeof entry.url !== 'string' || entry.url === '') {
      throw new Error(`missing download url for platform ${platform.key}`)
    }
    if (!isValidSha256(entry.sha256)) {
      throw new Error(`invalid sha256 for platform ${platform.key}: ${entry.sha256}`)
    }
    normalized[platform.key] = { url: entry.url, sha256: entry.sha256 }
  }
  return normalized
}

function assertVersion(version) {
  if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(version) || version === '') {
    throw new Error(`invalid version: ${String(version)}`)
  }
}

function assertPlatformKey(platformKey) {
  if (!PLATFORMS.some((platform) => platform.key === platformKey)) {
    throw new Error(`unknown platform key: ${platformKey}`)
  }
}

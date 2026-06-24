// Pure helpers for publishing the Ductum Homebrew tap formula to
// edictum-ai/homebrew-edictum. No filesystem, network, or process side effects
// live here so the publication contract can be unit-tested without hosted
// runners or live credentials.

import {
  DEFAULT_RELEASE_REPO,
  PLACEHOLDER_SHA256,
  PLATFORMS,
  artifactName,
  assertNoPlaceholderChecksums,
  generateFormula,
  generateTapFormula,
  isValidSha256,
  releaseDownloadUrl,
} from './homebrew-formula.mjs'

export const DEFAULT_TAP_REPO = 'edictum-ai/homebrew-edictum'
export const DEFAULT_TAP_BASE_BRANCH = 'main'
export const TAP_TOKEN_ENV = 'HOMEBREW_TAP_TOKEN'
export const TAP_REPO_ENV = 'HOMEBREW_TAP_REPO'
export const TAP_BASE_BRANCH_ENV = 'HOMEBREW_TAP_BASE_BRANCH'

const MANIFEST_LINE = /^([0-9a-f]{64})\s+(\S+)$/
const ARTIFACT_NAME = /^ductum_([0-9A-Za-z.+-]+)_([a-z0-9_]+)\.tar\.gz$/

export function formatChecksumLine({ version, platformKey, sha256 }) {
  if (!isValidSha256(sha256)) throw new Error(`invalid sha256 for ${platformKey}: ${sha256}`)
  return `${sha256}  ${artifactName(version, platformKey)}`
}

// Parses `sha256␣␣ductum_<version>_<platform>.tar.gz` lines (the shasum format
// emitted by the per-platform build). Multiple lines (concatenated from a
// multi-platform release matrix) are merged into one manifest.
export function parseChecksumManifest(text) {
  const checksums = {}
  let version
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const lineMatch = MANIFEST_LINE.exec(line)
    if (lineMatch == null) throw new Error(`unparseable checksum line: ${line}`)
    const [, sha256, filename] = lineMatch
    const nameMatch = ARTIFACT_NAME.exec(filename)
    if (nameMatch == null) throw new Error(`unexpected artifact filename: ${filename}`)
    const [, fileVersion, platformKey] = nameMatch
    if (!PLATFORMS.some((platform) => platform.key === platformKey)) {
      throw new Error(`unknown platform in manifest: ${platformKey}`)
    }
    if (version != null && version !== fileVersion) {
      throw new Error(`manifest mixes versions: ${version} and ${fileVersion}`)
    }
    version = fileVersion
    if (checksums[platformKey] != null && checksums[platformKey] !== sha256) {
      throw new Error(`conflicting checksums for ${platformKey}`)
    }
    checksums[platformKey] = sha256
  }
  if (version == null) throw new Error('checksum manifest is empty')
  return { version, checksums }
}

export function missingManifestPlatforms(checksums) {
  return PLATFORMS.filter((platform) => !isValidSha256((checksums ?? {})[platform.key])).map((p) => p.key)
}

export function assertCompleteManifest(checksums) {
  const missing = missingManifestPlatforms(checksums)
  if (missing.length > 0) {
    throw new Error(`incomplete checksum manifest; missing real checksums for: ${missing.join(', ')}`)
  }
}

// Real release downloads for every platform (publish path). Throws if any
// platform checksum is missing or a placeholder.
export function buildTapDownloads({ version, repo = DEFAULT_RELEASE_REPO, checksums }) {
  assertCompleteManifest(checksums)
  const downloads = {}
  for (const platform of PLATFORMS) {
    downloads[platform.key] = {
      url: releaseDownloadUrl({ repo, version, platformKey: platform.key }),
      sha256: checksums[platform.key],
    }
  }
  assertNoPlaceholderChecksums(downloads)
  return downloads
}

// Draft downloads for the dry-run preview. Platforms without a real checksum
// keep PLACEHOLDER_SHA256 so the operator can see what the multi-platform
// release CI will fill in. This is never used for publication.
export function buildDraftTapDownloads({ version, repo = DEFAULT_RELEASE_REPO, checksums = {} }) {
  const downloads = {}
  for (const platform of PLATFORMS) {
    downloads[platform.key] = {
      url: releaseDownloadUrl({ repo, version, platformKey: platform.key }),
      sha256: isValidSha256(checksums[platform.key]) ? checksums[platform.key] : PLACEHOLDER_SHA256,
    }
  }
  return downloads
}

export function tapBranchName(version) {
  return `chore/ductum-homebrew-${version}`
}

export function tapCommitMessage(version) {
  return `chore(distribution): publish ductum Homebrew formula ${version}`
}

export function tapPullRequestTitle(version) {
  return `chore(distribution): publish ductum Homebrew formula ${version}`
}

// Resolves the cross-repo credential. A configured HOMEBREW_TAP_TOKEN secret is
// mandatory for publication. We deliberately do NOT fall back to ambient `gh`
// auth or the workflow GITHUB_TOKEN: the tap lives in a different repository and
// must use an explicit, auditable credential.
export function resolveTapCredentials(env = process.env) {
  const token = env[TAP_TOKEN_ENV]
  if (token == null || String(token).trim() === '') {
    throw new Error(
      `cross-repo tap publication blocked: ${TAP_TOKEN_ENV} is not configured. ` +
        'Set a GitHub App / fine-grained token with PR access to the tap repository. ' +
        'Ambient gh login and the workflow GITHUB_TOKEN are intentionally not accepted.',
    )
  }
  return {
    token: String(token).trim(),
    repo: nonEmpty(env[TAP_REPO_ENV]) ?? DEFAULT_TAP_REPO,
    baseBranch: nonEmpty(env[TAP_BASE_BRANCH_ENV]) ?? DEFAULT_TAP_BASE_BRANCH,
  }
}

// Builds the publication plan. dryrun produces a draft (placeholders allowed,
// no credentials, no push). publish produces the real formula and requires a
// complete manifest, no placeholders, and configured credentials.
export function buildTapPublishPlan({
  mode,
  env = process.env,
  version,
  checksums = {},
  releaseRepo = DEFAULT_RELEASE_REPO,
}) {
  if (!['dryrun', 'publish'].includes(mode)) {
    throw new Error('tap publish mode must be dryrun or publish')
  }
  if (typeof version !== 'string' || version === '') throw new Error(`invalid version: ${String(version)}`)

  if (mode === 'dryrun') {
    const downloads = buildDraftTapDownloads({ version, repo: releaseRepo, checksums })
    return {
      mode,
      releaseRepo,
      tapRepo: nonEmpty(env[TAP_REPO_ENV]) ?? DEFAULT_TAP_REPO,
      version,
      push: false,
      draft: true,
      formula: generateFormula({ version, downloads }),
      downloads,
      missingPlatforms: missingManifestPlatforms(checksums),
      branch: tapBranchName(version),
      commitMessage: tapCommitMessage(version),
      pullRequestTitle: tapPullRequestTitle(version),
      credentialEnv: TAP_TOKEN_ENV,
    }
  }

  const credentials = resolveTapCredentials(env)
  const downloads = buildTapDownloads({ version, repo: releaseRepo, checksums })
  return {
    mode,
    releaseRepo,
    tapRepo: credentials.repo,
    baseBranch: credentials.baseBranch,
    version,
    push: true,
    draft: false,
    formula: generateTapFormula({ version, downloads }),
    downloads,
    missingPlatforms: [],
    branch: tapBranchName(version),
    commitMessage: tapCommitMessage(version),
    pullRequestTitle: tapPullRequestTitle(version),
    credentialEnv: TAP_TOKEN_ENV,
  }
}

function nonEmpty(value) {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  return trimmed === '' ? undefined : trimmed
}

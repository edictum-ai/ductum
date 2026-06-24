#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { DEFAULT_RELEASE_REPO, PLATFORMS } from './homebrew-formula.mjs'
import {
  buildTapPublishPlan,
  parseChecksumManifest,
  resolveTapCredentials,
} from './homebrew-tap.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages/ductum')

export function readPackageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version
}

function assertOutsideRepo(outDir) {
  const resolved = resolve(outDir)
  const rel = relative(ROOT, resolved)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(`refusing to write tap artifacts inside the repo: ${resolved}`)
  }
  return resolved
}

function parseArgs(argv) {
  const options = { mode: 'dryrun', manifest: undefined, outDir: undefined, skipAssetVerify: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === 'dryrun' || arg === 'publish') options.mode = arg
    else if (arg === '--manifest') options.manifest = argv[(i += 1)]
    else if (arg.startsWith('--manifest=')) options.manifest = arg.slice('--manifest='.length)
    else if (arg === '--out-dir') options.outDir = argv[(i += 1)]
    else if (arg.startsWith('--out-dir=')) options.outDir = arg.slice('--out-dir='.length)
    else if (arg === '--skip-asset-verify') options.skipAssetVerify = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function loadChecksums({ manifest, outDir }) {
  const path = manifest ?? (outDir != null ? join(resolve(outDir), 'checksums.txt') : undefined)
  if (path == null || !existsSync(path)) return { version: undefined, checksums: {} }
  return parseChecksumManifest(readFileSync(path, 'utf8'))
}

async function verifyAssetChecksums(downloads) {
  const mismatches = []
  for (const platform of PLATFORMS) {
    const entry = downloads[platform.key]
    const response = await fetch(entry.url, { redirect: 'follow' })
    if (!response.ok) {
      mismatches.push(`${platform.key}: ${entry.url} returned HTTP ${response.status}`)
      continue
    }
    const actual = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')
    if (actual !== entry.sha256) {
      mismatches.push(`${platform.key}: published asset sha256 ${actual} != manifest ${entry.sha256}`)
    }
  }
  if (mismatches.length > 0) {
    throw new Error(`release asset provenance check failed:\n${mismatches.join('\n')}`)
  }
}

function git(args, cwd, env = process.env) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, env })
  if (result.status !== 0) {
    throw new Error(`git ${redactGitArgs(args).join(' ')} failed (exit ${result.status})\n${redactSecretText(result.stderr ?? '')}`)
  }
  return result.stdout
}

function redactGitArgs(args) {
  return args.map((arg) => redactSecretText(arg))
}

function redactSecretText(value) {
  return String(value).replaceAll(/https:\/\/x-access-token:[^@\s]+@github\.com/g, 'https://x-access-token:[redacted]@github.com').trim()
}

async function executeTapPublish(plan, credentials) {
  const { token, repo, baseBranch } = credentials
  const workdir = mkdtempSync(join(tmpdir(), 'ductum-tap-'))
  try {
    const cloneUrl = `https://x-access-token:${token}@github.com/${repo}.git`
    const checkout = join(workdir, 'tap')
    git(['clone', '--depth', '1', '--branch', baseBranch, cloneUrl, checkout])
    git(['checkout', '-B', plan.branch], checkout)
    const formulaDir = join(checkout, 'Formula')
    mkdirSync(formulaDir, { recursive: true })
    writeFileSync(join(formulaDir, 'ductum.rb'), plan.formula)
    git(['add', 'Formula/ductum.rb'], checkout)
    git(['-c', 'user.name=ductum-release', '-c', 'user.email=release@edictum.ai', 'commit', '-m', plan.commitMessage], checkout)
    git(['push', '--force-with-lease', 'origin', plan.branch], checkout)
    const prUrl = await openTapPullRequest({ plan, repo, baseBranch, token })
    return { repo, branch: plan.branch, baseBranch, prUrl }
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

async function openTapPullRequest({ plan, repo, baseBranch, token }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ductum-release',
    },
    body: JSON.stringify({
      title: plan.pullRequestTitle,
      head: plan.branch,
      base: baseBranch,
      body: `Automated Homebrew formula update for ductum ${plan.version}.\n\nGenerated by scripts/publish-homebrew-tap.mjs from verified release-asset checksums.`,
    }),
  })
  if (response.ok) return (await response.json()).html_url
  const text = await response.text()
  if (response.status === 422 && text.includes('A pull request already exists')) {
    return `existing PR for ${plan.branch} on ${repo}`
  }
  throw new Error(`failed to open tap PR (HTTP ${response.status}): ${text}`)
}

function writeDryRunArtifacts(plan, outDir) {
  const tapDir = join(assertOutsideRepo(outDir ?? mkdtempSync(join(tmpdir(), 'ductum-tap-'))), 'tap')
  const formulaDir = join(tapDir, 'Formula')
  mkdirSync(formulaDir, { recursive: true })
  const formulaPath = join(formulaDir, 'ductum.rb')
  writeFileSync(formulaPath, plan.formula)
  const planPath = join(tapDir, 'publish-plan.json')
  writeFileSync(planPath, `${JSON.stringify({
    mode: plan.mode,
    draft: plan.draft,
    tapRepo: plan.tapRepo,
    releaseRepo: plan.releaseRepo,
    version: plan.version,
    branch: plan.branch,
    commitMessage: plan.commitMessage,
    pullRequestTitle: plan.pullRequestTitle,
    credentialEnv: plan.credentialEnv,
    missingPlatforms: plan.missingPlatforms,
    downloads: plan.downloads,
  }, null, 2)}\n`)
  return { tapDir, formulaPath, planPath }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const packageVersion = readPackageVersion()
  const { version: manifestVersion, checksums } = loadChecksums(options)
  if (manifestVersion != null && manifestVersion !== packageVersion) {
    throw new Error(`checksum manifest version ${manifestVersion} does not match packages/ductum ${packageVersion}`)
  }
  const plan = buildTapPublishPlan({
    mode: options.mode,
    version: packageVersion,
    checksums,
    releaseRepo: DEFAULT_RELEASE_REPO,
  })

  if (options.mode === 'dryrun') {
    const written = writeDryRunArtifacts(plan, options.outDir)
    console.log(JSON.stringify({
      kind: 'homebrew.tap.dryrun',
      data: {
        tapRepo: plan.tapRepo,
        version: plan.version,
        draft: plan.draft,
        missingPlatforms: plan.missingPlatforms,
        formula: written.formulaPath,
        plan: written.planPath,
      },
    }, null, 2))
    console.error(`\nTap publication preview written to: ${written.tapDir}`)
    console.error(`Draft formula: ${written.formulaPath}`)
    console.error(`Publication plan: ${written.planPath}`)
    if (plan.missingPlatforms.length > 0) {
      console.error(`Placeholder checksums remain for: ${plan.missingPlatforms.join(', ')} (filled by the multi-platform release matrix; publish is blocked until real).`)
    }
    console.error(`Cross-repo publish requires ${plan.credentialEnv}; not used in dry run.`)
    return
  }

  const credentials = resolveTapCredentials(process.env)
  if (!options.skipAssetVerify) await verifyAssetChecksums(plan.downloads)
  const published = await executeTapPublish(plan, credentials)
  console.log(JSON.stringify({ kind: 'homebrew.tap.published', data: published }, null, 2))
  console.error(`\nOpened Homebrew tap PR: ${published.prUrl}`)
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

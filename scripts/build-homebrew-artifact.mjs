#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  PLACEHOLDER_SHA256,
  PLATFORMS,
  artifactName,
  currentPlatformKey,
  generateFormula,
  releaseDownloadUrl,
} from './homebrew-formula.mjs'

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const PACKAGE_DIR = join(ROOT, 'packages/ductum')
const BUNDLE_FILES = ['dist', 'assets', 'package.json', 'LICENSE', 'README.md']
const NATIVE_BINDING = 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'

export function assertOutsideRepo(outDir, root = ROOT) {
  const resolved = resolve(outDir)
  const rel = relative(root, resolved)
  const inside = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
  if (inside) throw new Error(`refusing to write release artifacts inside the repo: ${resolved}`)
  return resolved
}

export function resolveOutDir(explicit) {
  if (explicit == null || String(explicit).trim() === '') return mkdtempSync(join(tmpdir(), 'ductum-homebrew-'))
  const resolved = assertOutsideRepo(explicit)
  mkdirSync(resolved, { recursive: true })
  return resolved
}

export function readPackageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8')).version
}

function parseArgs(argv) {
  const options = { outDir: undefined, repo: undefined, keepStage: false, nodeBin: undefined, localFormula: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--out-dir') options.outDir = argv[(i += 1)]
    else if (arg.startsWith('--out-dir=')) options.outDir = arg.slice('--out-dir='.length)
    else if (arg === '--repo') options.repo = argv[(i += 1)]
    else if (arg.startsWith('--repo=')) options.repo = arg.slice('--repo='.length)
    else if (arg === '--node-bin') options.nodeBin = argv[(i += 1)]
    else if (arg.startsWith('--node-bin=')) options.nodeBin = arg.slice('--node-bin='.length)
    else if (arg === '--keep-stage') options.keepStage = true
    else if (arg === '--local-formula') options.localFormula = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', shell: false, env })
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})\n${output}`)
  }
  return result
}

export function resolveRuntimeNodeBin(explicit = process.env.DUCTUM_HOMEBREW_NODE_BIN) {
  if (explicit != null && explicit.trim() !== '') return resolve(explicit)
  const brew = spawnSync('brew', ['--prefix', 'node@24'], { encoding: 'utf8', shell: false })
  if (brew.status === 0) {
    const candidate = join(brew.stdout.trim(), 'bin/node')
    if (existsSync(candidate)) return candidate
  }
  return process.execPath
}

export function readRuntimeNodeVersion(nodeBin) {
  const result = run(nodeBin, ['-p', 'process.versions.node'], ROOT)
  const version = result.stdout.trim()
  if (version === '') throw new Error(`could not read runtime Node version from ${nodeBin}`)
  return version
}

export function assertNode24Runtime(nodeVersion, nodeBin) {
  if (!nodeVersion.startsWith('24.')) {
    throw new Error(`Homebrew artifact runtime must be Node 24 because Formula/ductum.rb depends on node@24; ${nodeBin} reported ${nodeVersion}`)
  }
}

export function npmForNode(nodeBin) {
  const candidate = join(dirname(nodeBin), 'npm')
  return existsSync(candidate) ? candidate : 'npm'
}

function stageBundle(outDir) {
  run('node', ['scripts/build-publish-package.mjs'], ROOT)
  const stageDir = join(outDir, 'stage')
  rmSync(stageDir, { recursive: true, force: true })
  mkdirSync(stageDir, { recursive: true })
  for (const entry of BUNDLE_FILES) {
    const from = join(PACKAGE_DIR, entry)
    if (!existsSync(from)) throw new Error(`missing bundle input: packages/ductum/${entry}`)
    cpSync(from, join(stageDir, entry), { recursive: true })
  }
  return stageDir
}

function installRuntimeDeps(stageDir, nodeBin, nodeVersion) {
  assertNode24Runtime(nodeVersion, nodeBin)
  const npmBin = npmForNode(nodeBin)
  const runtimeEnv = { ...process.env, PATH: `${dirname(nodeBin)}:${process.env.PATH ?? ''}` }
  run(npmBin, ['install', '--omit=dev', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund'], stageDir, {
    ...runtimeEnv,
    npm_config_ignore_scripts: 'true',
  })
  run(npmBin, ['rebuild', 'better-sqlite3', '--ignore-scripts=false'], stageDir, {
    ...runtimeEnv,
    npm_config_ignore_scripts: 'false',
  })
  if (!existsSync(join(stageDir, NATIVE_BINDING))) {
    throw new Error(`native binding missing after rebuild: ${NATIVE_BINDING}`)
  }
}

function packTarball(stageDir, outDir, version, platformKey) {
  const tarball = join(outDir, artifactName(version, platformKey))
  rmSync(tarball, { force: true })
  run('tar', ['-czf', tarball, '-C', stageDir, '.'], outDir)
  const sha256 = createHash('sha256').update(readFileSync(tarball)).digest('hex')
  return { tarball, sha256 }
}

export function buildDownloadsMap({ version, repo, platformKey, sha256, tarball, localFormula = false }) {
  const downloads = {}
  for (const platform of PLATFORMS) {
    downloads[platform.key] = {
      url: localFormula && platform.key === platformKey
        ? pathToFileURL(tarball).href
        : releaseDownloadUrl({ repo, version, platformKey: platform.key }),
      sha256: platform.key === platformKey ? sha256 : PLACEHOLDER_SHA256,
    }
  }
  return downloads
}

export function buildHomebrewArtifact({
  outDir: explicitOutDir,
  repo,
  keepStage = false,
  nodeBin: explicitNodeBin,
  localFormula = false,
} = {}) {
  const outDir = resolveOutDir(explicitOutDir)
  const nodeBin = resolveRuntimeNodeBin(explicitNodeBin)
  const nodeVersion = readRuntimeNodeVersion(nodeBin)
  assertNode24Runtime(nodeVersion, nodeBin)
  const version = readPackageVersion()
  const platformKey = currentPlatformKey()
  const stageDir = stageBundle(outDir)
  installRuntimeDeps(stageDir, nodeBin, nodeVersion)
  const { tarball, sha256 } = packTarball(stageDir, outDir, version, platformKey)
  const downloads = buildDownloadsMap({ version, repo, platformKey, sha256, tarball, localFormula })
  const formula = generateFormula({ version, downloads })
  const formulaDir = join(outDir, 'Formula')
  mkdirSync(formulaDir, { recursive: true })
  const formulaPath = join(formulaDir, 'ductum.rb')
  writeFileSync(formulaPath, formula)
  // shasum-format manifest line consumed by scripts/publish-homebrew-tap.mjs.
  // The multi-platform release matrix concatenates one line per runner into a
  // complete manifest before the tap formula is published.
  const checksumsPath = join(outDir, 'checksums.txt')
  writeFileSync(checksumsPath, `${sha256}  ${artifactName(version, platformKey)}\n`)
  if (!keepStage) rmSync(stageDir, { recursive: true, force: true })
  return {
    outDir,
    version,
    platformKey,
    tarball,
    sha256,
    checksumsPath,
    formulaPath,
    nodeBin,
    nodeVersion,
    formulaMode: localFormula ? 'local' : 'release',
    placeholderPlatforms: PLATFORMS.filter((platform) => platform.key !== platformKey).map((platform) => platform.key),
  }
}

function main() {
  let result
  try {
    result = buildHomebrewArtifact(parseArgs(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const outsideRepo = relative(ROOT, result.outDir).startsWith('..')
  console.log(JSON.stringify({
    kind: 'homebrew.artifact.built',
    data: {
      outDir: result.outDir,
      outsideRepo,
      version: result.version,
      platform: result.platformKey,
      tarball: result.tarball.slice(result.outDir.length + 1),
      sha256: result.sha256,
      checksums: result.checksumsPath.slice(result.outDir.length + 1),
      formula: result.formulaPath.slice(result.outDir.length + 1),
      nodeBin: result.nodeBin,
      nodeVersion: result.nodeVersion,
      formulaMode: result.formulaMode,
      placeholderPlatforms: result.placeholderPlatforms,
    },
  }, null, 2))
  console.error(`\nRelease outputs written to: ${result.outDir}`)
  console.error(`Inspect formula: ${result.formulaPath}`)
  console.error(`Platform tarball: ${result.tarball} (sha256 ${result.sha256})`)
  console.error(`Checksum manifest: ${result.checksumsPath}`)
  if (result.placeholderPlatforms.length > 0) {
    console.error(`Placeholder checksums remain for: ${result.placeholderPlatforms.join(', ')} (filled by multi-platform release CI).`)
  }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) main()

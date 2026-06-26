#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const WRITABLE_PACKAGE_CACHE_DIRS = new Set(['.vite', '.vite-temp'])

function readGitPath(args, cwd, run = execFileSync) {
  return run('git', args, { cwd, encoding: 'utf8' }).trim()
}

function linkDirectory(target, source) {
  symlinkSync(source, target, 'dir')
}

function mirrorPackageNodeModules(targetDir, sourceDir, exists, readDir, mkdir, link) {
  mkdir(targetDir, { recursive: true })
  for (const entry of readDir(sourceDir, { withFileTypes: true })) {
    if (WRITABLE_PACKAGE_CACHE_DIRS.has(entry.name)) continue
    const target = join(targetDir, entry.name)
    if (exists(target)) continue
    link(target, join(sourceDir, entry.name))
  }
}

export function ensureWorktreeNodeModules({
  cwd = process.cwd(),
  exists = existsSync,
  readDir = readdirSync,
  mkdir = mkdirSync,
  run = execFileSync,
  link = linkDirectory,
  log = console.log,
} = {}) {
  const repoRoot = readGitPath(['rev-parse', '--show-toplevel'], cwd, run)
  const gitCommonDir = readGitPath(['rev-parse', '--git-common-dir'], cwd, run)
  const sourceRepoRoot = resolve(repoRoot, gitCommonDir, '..')

  if (sourceRepoRoot === repoRoot) return { linked: false, reason: 'not-worktree' }

  const sourceRootNodeModules = join(sourceRepoRoot, 'node_modules')
  if (!exists(sourceRootNodeModules)) return { linked: false, reason: 'source-node-modules-missing' }

  let linkedAny = false
  const rootNodeModules = join(repoRoot, 'node_modules')
  if (!exists(rootNodeModules)) {
    link(rootNodeModules, sourceRootNodeModules)
    linkedAny = true
    log(`Linked ${rootNodeModules} -> ${sourceRootNodeModules}`)
  }

  const packagesDir = join(repoRoot, 'packages')
  if (exists(packagesDir)) {
    for (const entry of readDir(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageNodeModules = join(packagesDir, entry.name, 'node_modules')
      const sourcePackageNodeModules = join(sourceRepoRoot, 'packages', entry.name, 'node_modules')
      if (exists(packageNodeModules) || !exists(sourcePackageNodeModules)) continue
      mirrorPackageNodeModules(packageNodeModules, sourcePackageNodeModules, exists, readDir, mkdir, link)
      linkedAny = true
      log(`Mirrored ${packageNodeModules} from ${sourcePackageNodeModules}`)
    }
  }

  return { linked: linkedAny, reason: linkedAny ? 'linked' : 'noop' }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureWorktreeNodeModules()
}

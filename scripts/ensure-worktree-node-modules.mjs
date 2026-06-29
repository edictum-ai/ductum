#!/usr/bin/env node

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const WRITABLE_PACKAGE_CACHE_DIRS = new Set(['.vite', '.vite-temp'])
const WORKSPACE_PACKAGE_SCOPES = new Set(['@ductum'])

function readGitPath(args, cwd, run = execFileSync) {
  return run('git', args, { cwd, encoding: 'utf8' }).trim()
}

function linkDirectory(target, source) {
  symlinkSync(source, target, 'dir')
}

function shouldMirrorNodeModuleEntry(name) {
  return !WRITABLE_PACKAGE_CACHE_DIRS.has(name) && !WORKSPACE_PACKAGE_SCOPES.has(name)
}

function isSymlinkTo(target, source, lstat, readLink) {
  try {
    const stat = lstat(target)
    if (!stat.isSymbolicLink()) return false
    const resolved = resolve(dirname(target), readLink(target))
    return resolved === source
  } catch {
    return false
  }
}

function removeSourceLink(target, source, exists, lstat, readLink, remove) {
  if (!exists(target) || !isSymlinkTo(target, source, lstat, readLink)) return false
  remove(target, { recursive: true, force: true })
  return true
}

function removeWorkspaceScopeLinks(targetDir, sourceDir, exists, lstat, readLink, remove) {
  let removedAny = false
  for (const scope of WORKSPACE_PACKAGE_SCOPES) {
    const target = join(targetDir, scope)
    const source = join(sourceDir, scope)
    if (removeSourceLink(target, source, exists, lstat, readLink, remove)) removedAny = true
  }
  return removedAny
}

function mirrorNodeModules(targetDir, sourceDir, exists, readDir, mkdir, link) {
  let linkedAny = false
  mkdir(targetDir, { recursive: true })
  for (const entry of readDir(sourceDir, { withFileTypes: true })) {
    if (!shouldMirrorNodeModuleEntry(entry.name)) continue
    const target = join(targetDir, entry.name)
    if (exists(target)) continue
    link(target, join(sourceDir, entry.name))
    linkedAny = true
  }
  return linkedAny
}

export function ensureWorktreeNodeModules({
  cwd = process.cwd(),
  exists = existsSync,
  readDir = readdirSync,
  mkdir = mkdirSync,
  run = execFileSync,
  link = linkDirectory,
  lstat = lstatSync,
  readLink = readlinkSync,
  remove = rmSync,
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
  if (removeSourceLink(rootNodeModules, sourceRootNodeModules, exists, lstat, readLink, remove)) {
    log(`Removed source checkout link ${rootNodeModules} -> ${sourceRootNodeModules}`)
  }
  if (exists(rootNodeModules) && removeWorkspaceScopeLinks(rootNodeModules, sourceRootNodeModules, exists, lstat, readLink, remove)) {
    linkedAny = true
    log(`Removed workspace package links from ${rootNodeModules}`)
  }
  if (!exists(rootNodeModules)) {
    if (mirrorNodeModules(rootNodeModules, sourceRootNodeModules, exists, readDir, mkdir, link)) {
      linkedAny = true
      log(`Mirrored ${rootNodeModules} from ${sourceRootNodeModules}`)
    }
  }

  const packagesDir = join(repoRoot, 'packages')
  if (exists(packagesDir)) {
    for (const entry of readDir(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packageNodeModules = join(packagesDir, entry.name, 'node_modules')
      const sourcePackageNodeModules = join(sourceRepoRoot, 'packages', entry.name, 'node_modules')
      if (!exists(sourcePackageNodeModules)) continue
      if (exists(packageNodeModules) && removeWorkspaceScopeLinks(packageNodeModules, sourcePackageNodeModules, exists, lstat, readLink, remove)) {
        linkedAny = true
        log(`Removed workspace package links from ${packageNodeModules}`)
      }
      if (mirrorNodeModules(packageNodeModules, sourcePackageNodeModules, exists, readDir, mkdir, link)) {
        linkedAny = true
        log(`Mirrored ${packageNodeModules} from ${sourcePackageNodeModules}`)
      }
    }
  }

  return { linked: linkedAny, reason: linkedAny ? 'linked' : 'noop' }
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ensureWorktreeNodeModules()
}

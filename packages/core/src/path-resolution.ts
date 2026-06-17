import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

export function normalizePathSeparators(value: string): string {
  return value.replaceAll('\\', '/')
}

export function resolvePathWithSymlinkAwareAncestor(path: string): string {
  const absolutePath = resolve(path)
  if (existsSync(absolutePath)) {
    return safeRealpath(absolutePath)
  }

  const missingSegments: string[] = []
  let probe = absolutePath
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) {
      return absolutePath
    }
    missingSegments.unshift(basename(probe))
    probe = parent
  }

  const resolvedAncestor = safeRealpath(probe)
  return missingSegments.length === 0
    ? resolvedAncestor
    : resolve(resolvedAncestor, ...missingSegments)
}

/** Resolve symlinks, falling back to the original path if it doesn't exist yet. */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

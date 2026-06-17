import { isAbsolute, relative, resolve } from 'node:path'

import { normalizePathSeparators, resolvePathWithSymlinkAwareAncestor } from './path-resolution.js'
import { validateWorkflowCommandScope } from './workflow-command-scope.js'

const FILE_PATH_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit'])
const FILE_PATH_ARG_KEYS = ['file_path', 'filePath', 'path', 'notebook_path'] as const

export interface NormalizeWorkflowToolArgsOptions {
  baseDir?: string | null
  protectedPaths?: readonly string[]
  allowShellFileMutation?: boolean
  activeStage?: string | null
}

export interface WorkflowToolPathScopeResult {
  allowed: boolean
  reason?: string
}

export function normalizeWorkflowToolArgs(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: NormalizeWorkflowToolArgsOptions = {},
): Record<string, unknown> {
  if (!FILE_PATH_TOOLS.has(toolName)) {
    return { ...toolArgs }
  }
  return normalizeWorkflowValue(toolArgs, options) as Record<string, unknown>
}

export function validateWorkflowToolPathScope(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: NormalizeWorkflowToolArgsOptions = {},
): WorkflowToolPathScopeResult {
  if (!FILE_PATH_TOOLS.has(toolName) || options.baseDir == null || options.baseDir.trim() === '') {
    return { allowed: true }
  }

  for (const entry of collectWorkflowPaths(toolArgs)) {
    if (entry.value.trim() === '') continue
    if (isPathInsideBase(entry.value, options.baseDir)) continue
    return {
      allowed: false,
      reason: `${toolName} ${entry.keyPath} "${entry.value}" is outside the run working directory ${options.baseDir}`,
    }
  }

  return { allowed: true }
}

export function validateWorkflowToolCommandScope(
  toolName: string,
  toolArgs: Record<string, unknown>,
  options: NormalizeWorkflowToolArgsOptions = {},
): WorkflowToolPathScopeResult {
  if (toolName !== 'Bash') {
    return { allowed: true }
  }

  const command = typeof toolArgs.command === 'string' ? toolArgs.command : null
  if (command == null || command.trim() === '') {
    return { allowed: true }
  }

  return validateWorkflowCommandScope(command, options)
}

export function normalizeWorkflowPath(
  filePath: string,
  options: NormalizeWorkflowToolArgsOptions = {},
): string {
  const normalizedPath = normalizePathSeparators(filePath)
  if (!isAbsolute(filePath)) {
    return normalizedPath
  }

  // Resolve symlinks (macOS: /tmp → /private/tmp) so relative() works correctly
  const rawBaseDir = resolve(options.baseDir ?? process.cwd())
  const baseDir = resolvePathWithSymlinkAwareAncestor(rawBaseDir)
  const resolvedFilePath = resolvePathWithSymlinkAwareAncestor(filePath)
  const relativePath = normalizePathSeparators(relative(baseDir, resolvedFilePath))
  if (relativePath !== '' && !relativePath.startsWith('../') && relativePath !== '..') {
    return relativePath
  }

  return normalizedPath
}

function isPathInsideBase(filePath: string, baseDir: string): boolean {
  const base = resolvePathWithSymlinkAwareAncestor(resolve(baseDir))
  const target = resolvePathWithSymlinkAwareAncestor(
    isAbsolute(filePath) ? resolve(filePath) : resolve(base, filePath),
  )
  const relativePath = normalizePathSeparators(relative(base, target))
  return relativePath === '' || (!relativePath.startsWith('../') && relativePath !== '..' && !isAbsolute(relativePath))
}

function normalizeWorkflowValue(
  value: unknown,
  options: NormalizeWorkflowToolArgsOptions,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeWorkflowValue(item, options))
  }
  if (value == null || typeof value !== 'object') {
    return value
  }

  const normalizedEntries = Object.entries(value).map(([key, entryValue]) => {
    if (typeof entryValue === 'string' && entryValue !== '' && FILE_PATH_ARG_KEYS.includes(key as typeof FILE_PATH_ARG_KEYS[number])) {
      return [key, normalizeWorkflowPath(entryValue, options)]
    }
    return [key, normalizeWorkflowValue(entryValue, options)]
  })
  return Object.fromEntries(normalizedEntries)
}

function collectWorkflowPaths(
  value: unknown,
  parentPath = '',
): Array<{ keyPath: string; value: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectWorkflowPaths(item, `${parentPath}[${index}]`))
  }
  if (value == null || typeof value !== 'object') {
    return []
  }

  const matches: Array<{ keyPath: string; value: string }> = []
  for (const [key, entryValue] of Object.entries(value)) {
    const keyPath = parentPath === '' ? key : `${parentPath}.${key}`
    if (typeof entryValue === 'string' && FILE_PATH_ARG_KEYS.includes(key as typeof FILE_PATH_ARG_KEYS[number])) {
      matches.push({ keyPath, value: entryValue })
      continue
    }
    matches.push(...collectWorkflowPaths(entryValue, keyPath))
  }
  return matches
}

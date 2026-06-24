import { isAbsolute, relative, resolve } from 'node:path'

import { normalizePathSeparators, resolvePathWithSymlinkAwareAncestor } from './path-resolution.js'
import type { WorkflowCommandScopeOptions, WorkflowCommandScopeResult } from './workflow-command-scope.js'

const DIRECT_READ_VERBS = new Set(['cat', 'head', 'ls', 'tail'])
const NAVIGATION_VERBS = new Set(['cd', 'pushd'])
const SHELL_SEGMENT_BOUNDARIES = new Set([';', '&', '|', '\n'])

interface ScopeCheck {
  type: 'path' | 'ambiguous'
  value: string
}

export function validateWorktreePathScope(
  command: string,
  options: WorkflowCommandScopeOptions,
): WorkflowCommandScopeResult {
  const rawBaseDir = options.baseDir
  if (rawBaseDir == null || rawBaseDir.trim() === '') {
    return { allowed: true }
  }

  const baseDir = resolvePathWithSymlinkAwareAncestor(resolve(rawBaseDir))
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeShellSegment(segment)
    if (tokens.length === 0) continue
    const scopeCheck = collectScopeCheck(tokens)
    if (scopeCheck == null) continue
    if (scopeCheck.type === 'ambiguous') {
      return {
        allowed: false,
        reason: `Bash command references path "${scopeCheck.value}" that could not be verified inside the run worktree ${rawBaseDir}`,
      }
    }
    const resolved = resolvePathWithSymlinkAwareAncestor(resolve(scopeCheck.value))
    if (isInsideWorktree(resolved, baseDir)) continue
    return {
      allowed: false,
      reason: `Bash command references path "${scopeCheck.value}" outside the run worktree ${rawBaseDir}`,
    }
  }

  return { allowed: true }
}

function collectScopeCheck(tokens: string[]): ScopeCheck | null {
  const verb = tokens[0]
  if (verb == null) return null

  if (NAVIGATION_VERBS.has(verb)) {
    return firstPathLikeArgument(tokens.slice(1), { skipInitialValue: false, returnRemainingOnly: false })
  }

  if (verb === 'git') {
    for (let index = 1; index < tokens.length; index += 1) {
      if (tokens[index] !== '-C') continue
      return classifyPathToken(tokens[index + 1] ?? '')
    }
    return null
  }

  if (DIRECT_READ_VERBS.has(verb)) {
    return firstPathLikeArgument(tokens.slice(1), { skipInitialValue: false, returnRemainingOnly: false })
  }

  if (verb === 'find') {
    return firstPathLikeArgument(tokens.slice(1), { skipInitialValue: false, returnRemainingOnly: false })
  }

  if (verb === 'grep' || verb === 'rg') {
    return firstPathLikeArgument(tokens.slice(1), { skipInitialValue: true, returnRemainingOnly: true })
  }

  if (verb === 'sed') {
    return firstPathLikeArgument(tokens.slice(1), { skipInitialValue: true, returnRemainingOnly: true })
  }

  return null
}

function firstPathLikeArgument(
  tokens: string[],
  options: { skipInitialValue: boolean; returnRemainingOnly: boolean },
): ScopeCheck | null {
  let skippedValue = options.skipInitialValue === false
  for (const token of tokens) {
    if (token.startsWith('-')) continue
    if (!skippedValue) {
      skippedValue = true
      continue
    }
    const candidate = classifyPathToken(token)
    if (candidate != null) return candidate
    if (options.returnRemainingOnly) continue
  }
  return null
}

function classifyPathToken(token: string): ScopeCheck | null {
  const value = token.trim()
  if (value === '' || value === '-' || value.startsWith('-')) return null
  if (isAmbiguousPathToken(value)) {
    return { type: 'ambiguous', value }
  }
  if (!isAbsolute(value)) return null
  return { type: 'path', value }
}

function isAmbiguousPathToken(token: string): boolean {
  return token.startsWith('~/')
    || token === '~'
    || token.includes('$')
    || token.includes('`')
    || token.includes('*')
    || token.includes('?')
    || token.includes('[')
    || token.includes(']')
    || token.startsWith('<(')
    || token.startsWith('>(')
}

function isInsideWorktree(target: string, baseDir: string): boolean {
  const relativePath = normalizePathSeparators(relative(baseDir, target))
  return relativePath === ''
    || (!relativePath.startsWith('../') && relativePath !== '..' && !isAbsolute(relativePath))
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (char == null) continue
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote != null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    const next = command[index + 1] ?? ''
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      segments.push(current)
      current = ''
      index += 1
      continue
    }
    if (SHELL_SEGMENT_BOUNDARIES.has(char)) {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }

  segments.push(current)
  return segments
}

function tokenizeShellSegment(segment: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of segment) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (quote != null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (current !== '') tokens.push(current)
  return tokens
}

import { isAbsolute, resolve } from 'node:path'

import { normalizePathSeparators, resolvePathWithSymlinkAwareAncestor } from './path-resolution.js'
import { validateWorktreePathScope } from './workflow-command-worktree-scope.js'

const PROTECTED_DB_ENV_REFS = ['$DUCTUM_DB_PATH', '${DUCTUM_DB_PATH}'] as const
const OUTPUT_REDIRECT_RE = /(^|[^<])(?:\d?>>?|\d?>\||&>)\s*(?!&\d\b)\S+/
const FILE_MUTATION_COMMAND_RE = /(^|[\s;|&()"'])(?:apply_patch|cp|mkdir|mv|rm|rmdir|touch|truncate)\b/
const IN_PLACE_EDIT_RE = /(^|[\s;|&()"'])(?:sed\b[^\n;&|]*\s-i(?:\s|$)|perl\b[^\n;&|]*\s-[^\s;&|]*i[^\s;&|]*)/
const TEE_WRITE_RE = /(^|[\s;|&()"'])tee\b/
const WORKTREE_GIT_MUTATION_RE = /(^|[\s;|&()"'])git\s+(?:apply|checkout|cherry-pick|clean|merge|rebase|reset|restore|rm|stash|switch)\b/
const INTERPRETER_RE = /(^|[\s;|&()"'])(?:node|perl|php|python3?|ruby)\b/
const INTERPRETER_HEREDOC_RE = /(^|[\s;|&()"'])(?:node|perl|php|python3?|ruby)\b[\s\S]*<<<?/
const INTERPRETER_WRITE_API_RE =
  /\b(?:appendFile(?:Sync)?|createWriteStream|fs\.open|fs\.write|openSync|writeBytes|writeFile(?:Sync)?|write_text|write_bytes)\b|\bopen\s*\([^)]*,\s*['"][wax+]/
const INTERACTIVE_SHELL_OR_INTERPRETER_RE =
  /(^|[\s;|&()"'])(?:(?:\/(?:usr\/)?bin\/)?(?:bash|sh|zsh|node|perl|php|python3?|ruby))\s*$/

export interface WorkflowCommandScopeOptions {
  baseDir?: string | null
  protectedPaths?: readonly string[]
  allowShellFileMutation?: boolean
  activeStage?: string | null
}

export interface WorkflowCommandScopeResult {
  allowed: boolean
  reason?: string
}

export function validateWorkflowCommandScope(
  command: string,
  options: WorkflowCommandScopeOptions = {},
): WorkflowCommandScopeResult {
  const protectedPathResult = validateProtectedPathAccess(command, options)
  if (!protectedPathResult.allowed) {
    return protectedPathResult
  }

  const worktreeScopeResult = validateWorktreePathScope(command, options)
  if (!worktreeScopeResult.allowed) {
    return worktreeScopeResult
  }

  if (options.allowShellFileMutation === false && commandMayMutateFiles(command)) {
    return {
      allowed: false,
      reason: shellMutationBlockedReason(options.activeStage),
    }
  }

  return { allowed: true }
}

function validateProtectedPathAccess(
  command: string,
  options: WorkflowCommandScopeOptions,
): WorkflowCommandScopeResult {
  if (PROTECTED_DB_ENV_REFS.some((value) => command.includes(value))) {
    return {
      allowed: false,
      reason: 'Bash command references DUCTUM_DB_PATH; use the Ductum CLI/API instead of direct SQLite access',
    }
  }

  const protectedPaths = createProtectedPathSet(options.protectedPaths ?? [])
  if (protectedPaths.length === 0) {
    return { allowed: true }
  }

  const normalizedCommand = normalizePathSeparators(command)
  for (const protectedPath of protectedPaths) {
    if (normalizedCommand.includes(protectedPath.normalized)) {
      return {
        allowed: false,
        reason: `Bash command references protected factory database path ${protectedPath.display}; use the Ductum CLI/API instead of direct SQLite access`,
      }
    }
  }

  const baseDir = options.baseDir == null || options.baseDir.trim() === ''
    ? null
    : resolvePathWithSymlinkAwareAncestor(resolve(options.baseDir))
  for (const token of tokenizeShellCommand(command)) {
    const candidate = stripShellTokenPathNoise(token)
    if (candidate === '') continue
    const resolved = resolveShellPathCandidate(candidate, baseDir)
    if (resolved == null) continue
    const normalized = normalizePathSeparators(resolved)
    const match = protectedPaths.find((protectedPath) => protectedPath.normalized === normalized)
    if (match == null) continue
    return {
      allowed: false,
      reason: `Bash command references protected factory database path ${match.display}; use the Ductum CLI/API instead of direct SQLite access`,
    }
  }

  return { allowed: true }
}

function commandMayMutateFiles(command: string): boolean {
  return OUTPUT_REDIRECT_RE.test(command)
    || FILE_MUTATION_COMMAND_RE.test(command)
    || IN_PLACE_EDIT_RE.test(command)
    || TEE_WRITE_RE.test(command)
    || WORKTREE_GIT_MUTATION_RE.test(command)
    || INTERACTIVE_SHELL_OR_INTERPRETER_RE.test(command)
    || INTERPRETER_HEREDOC_RE.test(command)
    || (INTERPRETER_RE.test(command) && INTERPRETER_WRITE_API_RE.test(command))
}

function shellMutationBlockedReason(stage: string | null | undefined): string {
  const stageLabel = stage == null || stage.trim() === '' ? 'the current stage' : `stage "${stage}"`
  return `Bash command may mutate files during ${stageLabel}; use Write/Edit after the workflow reaches a write-enabled stage`
}

function createProtectedPathSet(paths: readonly string[]): Array<{ normalized: string; display: string }> {
  const protectedPaths = new Map<string, string>()
  for (const rawPath of paths) {
    if (rawPath.trim() === '' || rawPath === ':memory:') continue
    const resolvedPath = resolvePathWithSymlinkAwareAncestor(resolve(rawPath))
    for (const protectedPath of [
      resolvedPath,
      `${resolvedPath}-wal`,
      `${resolvedPath}-shm`,
      `${resolvedPath}-journal`,
    ]) {
      protectedPaths.set(normalizePathSeparators(protectedPath), protectedPath)
    }
  }
  return [...protectedPaths.entries()].map(([normalized, display]) => ({ normalized, display }))
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  for (const char of command) {
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
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (escaped) {
    current += '\\'
  }
  if (current !== '') {
    tokens.push(current)
  }
  return tokens
}

function stripShellTokenPathNoise(token: string): string {
  let value = token.trim()
  value = value.replace(/^[0-9]?>+/, '')
  value = value.replace(/^<+/, '')
  value = value.replace(/^[([{]+/, '')
  value = value.replace(/[)\]},.]+$/, '')
  return value
}

function resolveShellPathCandidate(candidate: string, baseDir: string | null): string | null {
  if (candidate.includes('$')) {
    return null
  }
  if (isAbsolute(candidate)) {
    return resolvePathWithSymlinkAwareAncestor(resolve(candidate))
  }
  if (baseDir == null || !candidate.includes('/')) {
    return null
  }
  return resolvePathWithSymlinkAwareAncestor(resolve(baseDir, candidate))
}

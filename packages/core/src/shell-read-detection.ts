const READ_VERBS = new Set([
  'ag',
  'awk',
  'basename',
  'cat',
  'diff',
  'dirname',
  'du',
  'file',
  'find',
  'grep',
  'head',
  'less',
  'ls',
  'od',
  'pwd',
  'readlink',
  'realpath',
  'rg',
  'sed',
  'sort',
  'stat',
  'strings',
  'tail',
  'test',
  'tree',
  'uniq',
  'wc',
  'xxd',
])

const OUTPUT_ONLY_VERBS = new Set(['echo', 'printf'])
const NOOP_VERBS = new Set([':', 'true'])
const PREFERRED_CONTEXT_READ_FILES = new Set(['README.md', 'SPEC.md', 'AGENTS.md', 'CLAUDE.md'])
const CONTROL_PREFIX_VERBS = new Set([
  '!',
  'break',
  'continue',
  'do',
  'done',
  'elif',
  'else',
  'fi',
  'if',
  'then',
])
const BOUNDARY_TOKENS = new Set([';', '&&', '||', '|', '&', '\n'])
const SHELL_WRITE_SYNTAX = /(?:^|[|&;()\s])(?:tee\b|[0-9]*>>?|[0-9]*>\||[0-9]*<<?)(?=[\s"']|$)/

export function extractWorkflowReadPath(command: string): string | null {
  const candidates = collectWorkflowReadPathCandidates(command)
  const preferred = candidates.find((candidate) => PREFERRED_CONTEXT_READ_FILES.has(candidate))
  if (preferred != null) return preferred
  return candidates.length === 1 ? candidates[0] ?? null : null
}

export function isSimpleWorkflowReadCommand(command: string): boolean {
  const inner = unwrapShellCommand(command.trim())
  if (SHELL_WRITE_SYNTAX.test(stripReadOnlyRedirects(inner))) return false
  const tokens = tokenizeShell(inner)
  return !tokens.some((token) => BOUNDARY_TOKENS.has(token)) && collectWorkflowReadPathCandidates(command).length === 1
}

export function collectWorkflowReadPathCandidates(command: string): string[] {
  const inner = unwrapShellCommand(command.trim())
  if (SHELL_WRITE_SYNTAX.test(stripReadOnlyRedirects(inner))) return []

  const tokens = tokenizeShell(inner)
  const candidates = new Set<string>()
  let segment: string[] = []

  function flushSegment(): boolean {
    if (segment.length === 0) return true
    while (CONTROL_PREFIX_VERBS.has(segment[0] ?? '')) segment = segment.slice(1)
    if (segment.length === 0) return true
    const verb = segment[0]
    if (verb == null) return true
    if (isReadOnlyForHeader(segment) || isReadOnlyBracketTest(segment)) {
      segment = []
      return true
    }
    if (OUTPUT_ONLY_VERBS.has(verb) || NOOP_VERBS.has(verb)) {
      segment = []
      return true
    }
    if (verb === 'env') {
      // Bare `env` (no arguments) prints environment variables and is
      // read-only.  `env VAR=value command args` can execute arbitrary
      // programs, so any argument presence must fail closed.
      const bareEnv = segment.length === 1
      segment = []
      return bareEnv
    }
    if (!READ_VERBS.has(verb)) return false
    for (const token of segment.slice(1)) {
      const candidate = normalizeRelativeReadPath(token)
      if (candidate != null) candidates.add(candidate)
    }
    segment = []
    return true
  }

  for (const token of tokens) {
    if (BOUNDARY_TOKENS.has(token)) {
      if (!flushSegment()) return []
      continue
    }
    segment.push(token)
  }
  if (!flushSegment()) return []

  return [...candidates]
}

function stripReadOnlyRedirects(command: string): string {
  return command.replace(/\s+2>\s*\/dev\/null(?=\s|$)/g, '')
}

function isReadOnlyForHeader(segment: string[]): boolean {
  if (segment[0] !== 'for' || segment.length < 4 || segment[2] !== 'in') return false
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment[1] ?? '')) return false
  return segment.slice(3).every((token) => /^[A-Za-z0-9_./*?[\]-]+$/.test(token))
}

function isReadOnlyBracketTest(segment: string[]): boolean {
  return (
    (segment[0] === '[' && segment.at(-1) === ']')
    || (segment[0] === '[[' && segment.at(-1) === ']]')
  )
}

function unwrapShellCommand(command: string): string {
  const quoted = command.match(/^(?:\/?bin\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1\s*$/)
  if (quoted?.[2] != null) return quoted[2].trim()
  const bare = command.match(/^(?:\/?bin\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(.+)$/)
  return bare?.[1]?.trim() ?? command
}

function tokenizeShell(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaped = false

  function flush(): void {
    if (current !== '') {
      tokens.push(current)
      current = ''
    }
  }

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]
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
    if (char === '\n' || char === ';' || char === '|') {
      flush()
      if (char === '|' && command[i + 1] === '|') {
        tokens.push('||')
        i += 1
      } else {
        tokens.push(char)
      }
      continue
    }
    if (char === '&') {
      flush()
      if (command[i + 1] === '&') {
        tokens.push('&&')
        i += 1
      } else {
        tokens.push('&')
      }
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    current += char
  }

  flush()
  return tokens
}

function normalizeRelativeReadPath(path: string): string | null {
  if (!isReadPathCandidate(path)) return null
  if (path.startsWith('/')) return null
  return path.replace(/^\.\//, '')
}

function isReadPathCandidate(token: string): boolean {
  if (token === '' || token.startsWith('-')) return false
  if (/^\d/.test(token)) return false
  if (token.includes('*') || token.includes('$') || token.includes('#')) return false
  return /\.[A-Za-z0-9]+$/.test(token) || token.includes('/')
}

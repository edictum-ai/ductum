/**
 * Public metadata gate for generated git subjects and PR bodies.
 *
 * Generated commit subjects, PR titles, and PR bodies are the public surface
 * of agent work. They must describe the actual product/code change and must
 * never carry factory process metadata (session/stage/recovery labels),
 * helper prose, synthetic metadata-only text, AI attribution, or
 * newline/body injection.
 *
 * The gate is fail-closed: an unsafe subject or body returns `{ ok: false }`
 * with the list of policy reasons. The caller is expected to block approval
 * or push when the check fails. Sanitization (`sanitizeGeneratedGitTitle`)
 * runs first to strip benign leading labels; this gate then validates the
 * sanitized output so a sanitization residue like `feat: task` (the
 * placeholder fallback) still fails.
 *
 * Token precision matters: legitimate domain tokens such as `S3` (Amazon
 * Simple Storage Service) MUST survive the gate, while stage labels `S0`,
 * `S1`, `S1a`, `S6`, `HOTFIX`, etc. MUST fail. The forbidden-token list
 * below is anchored on word boundaries and explicitly excludes `S3`.
 */

export interface PublicGitMetadataCheck {
  ok: boolean
  reasons: string[]
}

const CONVENTIONAL_TYPES = [
  'feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'style', 'perf', 'build', 'ci', 'revert',
] as const
const CONVENTIONAL_SUBJECT = new RegExp(
  `^(?:${CONVENTIONAL_TYPES.join('|')})(?:\\([\\w./-]+\\))?: .+$`,
  'i',
)

// Forbidden process/factory tokens. `S3` is deliberately NOT in this list
// because it is a legitimate domain token (Amazon S3) and the sanitizer
// already preserves it via a negative lookahead.
const FORBIDDEN_SUBJECT_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bauto-commit\b/i, label: 'auto-commit provenance' },
  { pattern: /\bfinalize\b/i, label: 'finalize helper prose' },
  { pattern: /\bpost-?p\d+\b/i, label: 'post-P* stage label' },
  { pattern: /\bS0\b/, label: 'stage label S0' },
  { pattern: /\bS1[a-z]?\b/, label: 'stage label S1' },
  { pattern: /\bS2\b/, label: 'stage label S2' },
  { pattern: /\bS4\b/, label: 'stage label S4' },
  { pattern: /\bS5\b/, label: 'stage label S5' },
  { pattern: /\bS6\b/, label: 'stage label S6' },
  { pattern: /\bS7\b/, label: 'stage label S7' },
  { pattern: /\bS8\b/, label: 'stage label S8' },
  { pattern: /\bS9\b/, label: 'stage label S9' },
  { pattern: /\bs(?!3\b)\d+[a-z]?\b/, label: 'lowercase stage label' },
  { pattern: /\bHOTFIX\b/, label: 'HOTFIX label' },
  { pattern: /\bP\d+\b/, label: 'planning label P*' },
  { pattern: /\bp-[a-z0-9][a-z0-9-]*/i, label: 'planning slug p-*' },
  { pattern: /\bsession[-_:][a-z0-9][a-z0-9-]*/i, label: 'session label' },
  { pattern: /\battempt[-_:][a-z0-9][a-z0-9-]*/i, label: 'attempt label' },
  { pattern: /\brun[-_:][a-z0-9][a-z0-9-]*/i, label: 'run label' },
]

// Body lines that indicate AI attribution or internal factory prose. Only
// explicit attribution prefixes are rejected so legitimate template
// sections (e.g. `## Summary`) and prose mentioning "AI" in context remain
// allowed.
const FORBIDDEN_BODY_LINE_PATTERNS: ReadonlyArray<RegExp> = [
  /^\s*co-authored-by:/i,
  /^\s*generated with\b/i,
  /^\s*🤖/,
  /^\s*generated-by:/i,
  /^\s*[-*]?\s*(attempt|run|session)\s*:/i,
]

const PLACEHOLDER_DESCRIPTIONS = new Set(['task', 'placeholder', 'untitled', 'unknown'])

export function checkPublicGitMetadata(subject: string, body?: string): PublicGitMetadataCheck {
  const reasons: string[] = []
  const trimmedSubject = subject.trim()

  if (trimmedSubject === '') {
    reasons.push('subject is empty')
    return { ok: false, reasons }
  }

  if (/[\r\n]/.test(trimmedSubject)) {
    reasons.push('subject contains newline (body injection)')
  }

  // Parse out the description so forbidden-token checks ignore the
  // conventional scope. Without this, `feat(s3): wire bucket policy`
  // would fail because the lowercase stage pattern matches `s3` inside
  // the scope. The scope is structural metadata; only the description
  // narrates the change and is where process/factory labels leak.
  const conventionalMatch = trimmedSubject.match(CONVENTIONAL_SUBJECT)
  const description = conventionalMatch == null
    ? trimmedSubject
    : trimmedSubject.slice(trimmedSubject.indexOf(':') + 1).trim()

  if (conventionalMatch == null) {
    reasons.push('subject is not conventional (expected "type: description" or "type(scope): description")')
  } else {
    if (description === '') {
      reasons.push('subject description is empty')
    } else if (PLACEHOLDER_DESCRIPTIONS.has(description.toLowerCase())) {
      reasons.push(`subject description is a synthetic placeholder (${description}), not a real code/product change`)
    }
  }

  for (const { pattern, label } of FORBIDDEN_SUBJECT_PATTERNS) {
    if (pattern.test(description)) {
      reasons.push(`subject contains forbidden process/factory token (${label})`)
    }
  }

  if (body != null && body.trim() !== '') {
    const lines = body.split(/\r?\n/)
    for (const line of lines) {
      if (FORBIDDEN_BODY_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
        reasons.push('body contains AI attribution or factory prose')
        break
      }
      for (const { pattern, label } of FORBIDDEN_SUBJECT_PATTERNS) {
        if (pattern.test(line)) {
          reasons.push(`body contains forbidden process/factory token (${label})`)
          break
        }
      }
    }
  }

  return { ok: reasons.length === 0, reasons }
}

export function assertPublicGitMetadataSafe(subject: string, body?: string): void {
  const check = checkPublicGitMetadata(subject, body)
  if (!check.ok) {
    throw new PublicGitMetadataError(check.reasons)
  }
}

export class PublicGitMetadataError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`public git metadata failed gate: ${reasons.join('; ')}`)
    this.name = 'PublicGitMetadataError'
  }
}

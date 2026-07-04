const LEADING_BRACKETED_PREFIX = /^\s*\[([^\]]+)\](?:\s*[:\-–—]\s*|\s+)*/
const LEADING_PROCESS_TOKEN = /^\s*(post-?p\d+|p\d+|p-[a-z0-9][a-z0-9-]*|s\d+[a-z]?|hotfix)(?:\s*[:\-–—]\s*|\s+)*/i
const PROCESS_TOKEN = /^(?:post-?p\d+|p\d+|p-[a-z0-9][a-z0-9-]*|s\d+[a-z]?|hotfix)$/i
const ALL_CAPS_DASH_SLUG = /[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*/g
const SHORT_ACRONYM_MAX_LENGTH = 3

export function sanitizeGeneratedGitTitle(title: string): string {
  const original = title.trim()
  if (original === '') return original
  let sanitized = original
  for (;;) {
    const bracketed = sanitized.match(LEADING_BRACKETED_PREFIX)
    if (bracketed != null && hasOnlyProcessTokens(bracketed[1] ?? '')) {
      sanitized = sanitized.slice(bracketed[0].length).trimStart()
      continue
    }
    const leadingToken = sanitized.match(LEADING_PROCESS_TOKEN)
    if (leadingToken == null) break
    sanitized = sanitized.slice(leadingToken[0].length).trimStart()
  }
  sanitized = sanitized.replace(/^[\s:–—-]+/, '').trim()
  // If stripping planning/process tokens consumed the entire title
  // (e.g. 'P3', '[post-P9 P4]'), fall back to a generic placeholder so
  // callers never have to guard against an empty result. 'task' matches
  // the sanitizeGitRefSegment fallback convention used elsewhere.
  if (sanitized === '') return 'task'
  sanitized = convertAllCapsSlugs(sanitized)
  return sanitized
}

function hasOnlyProcessTokens(value: string): boolean {
  const tokens = value
    .split(/[\s,/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => PROCESS_TOKEN.test(token))
}

function convertAllCapsSlugs(value: string): string {
  return value.replace(ALL_CAPS_DASH_SLUG, (slug) => {
    const words = slug.split('-')
    if (!words.some((word) => word.length > SHORT_ACRONYM_MAX_LENGTH)) return slug
    return words
      .map((word) => (word.length <= SHORT_ACRONYM_MAX_LENGTH ? word : word.toLowerCase()))
      .join(' ')
  })
}

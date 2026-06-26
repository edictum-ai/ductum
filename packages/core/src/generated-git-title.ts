const LEADING_BRACKETED_PREFIX = /^\s*\[([^\]]+)\](?:\s*[:\-–—]\s*|\s+)*/
const LEADING_PLANNING_TOKEN = /^\s*(post-?p\d+|p\d+|p-[a-z0-9][a-z0-9-]*)(?:\s*[:\-–—]\s*|\s+)*/i
const PLANNING_TOKEN = /^(?:post-?p\d+|p\d+|p-[a-z0-9][a-z0-9-]*)$/i

export function sanitizeGeneratedGitTitle(title: string): string {
  const original = title.trim()
  if (original === '') return original
  let sanitized = original
  for (;;) {
    const bracketed = sanitized.match(LEADING_BRACKETED_PREFIX)
    if (bracketed != null && hasOnlyPlanningTokens(bracketed[1] ?? '')) {
      sanitized = sanitized.slice(bracketed[0].length).trimStart()
      continue
    }
    const leadingToken = sanitized.match(LEADING_PLANNING_TOKEN)
    if (leadingToken == null) break
    sanitized = sanitized.slice(leadingToken[0].length).trimStart()
  }
  sanitized = sanitized.replace(/^[\s:–—-]+/, '').trim()
  return sanitized === '' ? original : sanitized
}

function hasOnlyPlanningTokens(value: string): boolean {
  const tokens = value
    .split(/[\s,/]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  return tokens.length > 0 && tokens.every((token) => PLANNING_TOKEN.test(token))
}

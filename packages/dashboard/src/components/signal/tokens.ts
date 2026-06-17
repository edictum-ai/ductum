/**
 * Signal theme tokens. The source of truth is the CSS custom properties
 * in index.css (:root and .dark) — this module exposes them as TypeScript
 * constants so primitive components can compose inline styles without a
 * runtime CSSOM read per render.
 *
 * Dark/light switching happens purely through the `.dark` class on
 * <html>; the `var(--signal-*)` references resolve per the computed CSS
 * tree. No component needs to know which theme is active.
 */

export const tokens = {
  // surfaces
  bg:      'var(--signal-bg)',
  canvas:  'var(--signal-canvas)',
  sunken:  'var(--signal-sunken)',
  raised:  'var(--signal-raised)',
  // strokes
  hair:    'var(--signal-hair)',
  rule:    'var(--signal-rule)',
  // text
  fg:      'var(--signal-fg)',
  strong:  'var(--signal-strong)',
  mid:     'var(--signal-mid)',
  dim:     'var(--signal-dim)',
  faint:   'var(--signal-faint)',
  // reserved chromatic
  accent:  'var(--signal-accent)',
  ok:      'var(--signal-ok)',
  warn:    'var(--signal-warn)',
  err:     'var(--signal-err)',
  info:    'var(--signal-info)',
  // agents (semantic, keyed by id)
  mimi:    'var(--signal-mimi)',
  codex:   'var(--signal-codex)',
  glm:     'var(--signal-glm)',
  haiku:   'var(--signal-haiku)',
  // type stacks
  sans: "'Geist Variable', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
} as const

export type Tokens = typeof tokens

/** Agent id → CSS variable. Falls back to mid-tier text color. */
export function agentColor(agentId: string | null | undefined): string {
  if (!agentId) return tokens.mid
  const key = agentId.toLowerCase()
  if (key === 'mimi' || key === 'codex' || key === 'glm' || key === 'haiku') {
    return tokens[key]
  }
  // Unknown agent id: try a stable fallback based on first char so
  // multiple unknowns stay distinguishable in mixed lists.
  const palette = [tokens.mimi, tokens.codex, tokens.glm, tokens.haiku]
  const idx = (key.charCodeAt(0) + (key.charCodeAt(1) ?? 0)) % palette.length
  return palette[idx] ?? tokens.mid
}

/** Status tone → CSS variable. */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'ok': return tokens.ok
    case 'warn': return tokens.warn
    case 'err': return tokens.err
    case 'info': return tokens.info
    case 'accent': return tokens.accent
    case 'mid': return tokens.mid
    default: return tokens.mid
  }
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'mid'

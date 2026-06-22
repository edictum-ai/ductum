/**
 * Signal theme tokens. The source of truth is the CSS custom properties in
 * index.css — this module exposes them as TypeScript constants so primitive
 * components can compose inline styles without a runtime CSSOM read per render.
 *
 * `:root` IS the dark baseline (the brand), so the var values resolve dark by
 * default. In dark mode the `.dark` class still rides on <html> so Tailwind
 * `dark:` literal utilities fire; light is the explicit `.light` override
 * (`:root.light`). The two classes are mutually exclusive (see lib/theme.ts +
 * main.tsx). The `var(--signal-*)` references resolve per the computed CSS
 * tree, so no component needs to know which theme is active.
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
  // agents — the calm, low-sat identity palette (see agentColor)
  mimi:    'var(--signal-mimi)',
  codex:   'var(--signal-codex)',
  glm:     'var(--signal-glm)',
  haiku:   'var(--signal-haiku)',
  // type stacks
  sans: "'Inter Variable', ui-sans-serif, system-ui, sans-serif",
  display: "'Archivo Variable', 'Inter Variable', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
} as const

export type Tokens = typeof tokens

/** The calm, low-sat agent palette. */
const AGENT_PALETTE = [tokens.mimi, tokens.codex, tokens.glm, tokens.haiku] as const

/** Canonical roster → its own dedicated brand tone (its identity). These map
 *  1:1 to the four palette entries so the named agents stay mutually distinct;
 *  a pure hash over a 4-color palette would collide (e.g. mimi ≡ glm). */
const ROSTER_COLOR: Record<string, string> = {
  mimi: tokens.mimi,
  codex: tokens.codex,
  glm: tokens.glm,
  haiku: tokens.haiku,
}

/**
 * Agent id → CSS variable. The canonical roster keeps its dedicated identity
 * color; any OTHER id is assigned deterministically by a rolling hash over the
 * palette, so a changing/unknown roster themes itself and a repeated id always
 * gets the same color — no brittle per-id branching, no weak first-char
 * fallback. Falls back to mid-tier text color for empty/missing ids.
 */
export function agentColor(agentId: string | null | undefined): string {
  if (!agentId) return tokens.mid
  const key = agentId.toLowerCase()
  const known = ROSTER_COLOR[key]
  if (known) return known
  // Hash the whole id (not just the first chars) so similar ids still spread.
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0
  }
  const idx = (hash >>> 0) % AGENT_PALETTE.length
  return AGENT_PALETTE[idx] ?? tokens.mid
}

/** Status tone → CSS variable (for inline color, e.g. a Dot or border). */
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

/**
 * Status tone → chip className: translucent fill + hairline border + text,
 * all derived from one signal hue (see the `.sig-tone*` rules in index.css).
 * The single place a domain status turns into a colored badge.
 */
export function toneBadgeClass(tone: Tone): string {
  return `sig-tone sig-tone-${tone}`
}

/** Status tone → text-only className (no fill/border). */
export function toneTextClass(tone: Tone): string {
  return `sig-tone-text sig-tone-${tone}`
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'accent' | 'mid'

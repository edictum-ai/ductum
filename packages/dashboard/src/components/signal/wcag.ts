/**
 * WCAG 2.1 contrast math for the Signal token system.
 *
 * The token values in index.css live as CSS custom properties (rgba over a
 * layered surface), so a runtime CSSOM read would be needed to observe them.
 * Instead, the surface hexes plus token rgba() source values are mirrored as
 * plain TS constants here and the contrast is computed analytically. That
 * lets the test suite (and any future token audit) prove the small-text
 * contrast contract without spinning up a browser.
 *
 * Keep these literals in sync with `index.css`. The signal-tokens test
 * asserts the contrast against every surface a token is rendered on; if you
 * change a value here or in the CSS, the test will force you to look at the
 * other side.
 */

/** Opaque or alpha color in the sRGB space CSS uses. */
export interface RGB {
  r: number
  g: number
  b: number
  a?: number
}

/** WCAG 2.1 relative luminance of an opaque color. */
export function luminance({ r, g, b }: RGB): number {
  const lin = (channel: number): number => {
    const cs = channel / 255
    return cs <= 0.04045 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG 2.1 contrast ratio between any two colors. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a)
  const lb = luminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Alpha-over compositing: the effective opaque color of `front` rendered
 * over `back`. Matches how the browser actually paints rgba() text on a
 * layered CSS surface.
 */
export function composite(front: RGB, back: RGB): RGB {
  const a = front.a ?? 1
  return {
    r: front.r * a + back.r * (1 - a),
    g: front.g * a + back.g * (1 - a),
    b: front.b * a + back.b * (1 - a),
  }
}

/** WCAG AA threshold for normal-sized body text (4.5:1). */
export const AA_NORMAL = 4.5
/** WCAG AA threshold for large text: 18pt regular or 14pt bold (3:1). */
export const AA_LARGE = 3

/* Mirror of the surface and base-color literals from index.css. */

export const DARK_SURFACES = {
  bg:     { r: 0x11, g: 0x13, b: 0x18 },
  canvas: { r: 0x17, g: 0x1a, b: 0x21 },
  sunken: { r: 0x0d, g: 0x0f, b: 0x13 },
  raised: { r: 0x1d, g: 0x21, b: 0x2b },
} as const

export const LIGHT_SURFACES = {
  bg:     { r: 0xf6, g: 0xf3, b: 0xec },
  canvas: { r: 0xff, g: 0xff, b: 0xff },
  sunken: { r: 0xef, g: 0xec, b: 0xe3 },
  raised: { r: 0xfb, g: 0xfa, b: 0xf5 },
} as const

/** Base text color for the dark theme (the rgba source of mid/dim/faint). */
export const DARK_TEXT_BASE: RGB = { r: 234, g: 236, b: 240 }
/** Base text color for the light theme. */
export const LIGHT_TEXT_BASE: RGB = { r: 22, g: 24, b: 32 }

/** Dark-theme dim/faint as alpha over DARK_TEXT_BASE; mirrors index.css. */
export const DARK_TEXT_TOKENS = {
  mid:   { ...DARK_TEXT_BASE, a: 0.82 },
  dim:   { ...DARK_TEXT_BASE, a: 0.70 },
  faint: { ...DARK_TEXT_BASE, a: 0.62 },
} as const

/** Light-theme dim/faint as alpha over LIGHT_TEXT_BASE; mirrors index.css. */
export const LIGHT_TEXT_TOKENS = {
  mid:   { ...LIGHT_TEXT_BASE, a: 0.84 },
  dim:   { ...LIGHT_TEXT_BASE, a: 0.74 },
  faint: { ...LIGHT_TEXT_BASE, a: 0.70 },
} as const

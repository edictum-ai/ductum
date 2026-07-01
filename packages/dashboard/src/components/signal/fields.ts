import type { CSSProperties } from 'react'

import { tokens } from './tokens'

export const fieldStyle = {
  width: '100%',
  minWidth: 0,
  minHeight: 38,
  border: `1px solid ${tokens.rule}`,
  borderRadius: 8,
  background: `color-mix(in oklab, ${tokens.canvas} 88%, ${tokens.raised})`,
  color: tokens.fg,
  padding: '0 12px',
  fontFamily: tokens.sans,
  fontSize: 13,
  lineHeight: 1.35,
  boxShadow: `inset 0 1px 0 color-mix(in oklab, ${tokens.strong} 5%, transparent)`,
  outlineColor: tokens.accent,
} satisfies CSSProperties

export const compactFieldStyle = {
  ...fieldStyle,
  minHeight: 30,
  borderRadius: 7,
  padding: '0 10px',
  fontSize: 12,
} satisfies CSSProperties

export const textareaStyle = {
  ...fieldStyle,
  minHeight: 88,
  padding: '10px 12px',
  lineHeight: 1.5,
  resize: 'vertical',
} satisfies CSSProperties

export function fieldStyleWithFont(fontFamily: string): CSSProperties {
  return { ...fieldStyle, fontFamily }
}

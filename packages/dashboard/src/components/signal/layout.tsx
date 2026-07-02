import { type CSSProperties, type ElementType, type ReactNode } from 'react'

import { Caps, Mono } from './primitives'
import { tokens } from './tokens'

export type MetricTone = 'default' | 'info' | 'ok' | 'warn' | 'err' | 'accent'

const METRIC_TONES: Record<MetricTone, { color: string; bg: string; border: string }> = {
  default: {
    color: tokens.mid,
    bg: 'transparent',
    border: tokens.hair,
  },
  info: {
    color: tokens.info,
    bg: `color-mix(in oklab, ${tokens.info} 9%, transparent)`,
    border: `color-mix(in oklab, ${tokens.info} 38%, transparent)`,
  },
  ok: {
    color: tokens.ok,
    bg: `color-mix(in oklab, ${tokens.ok} 9%, transparent)`,
    border: `color-mix(in oklab, ${tokens.ok} 38%, transparent)`,
  },
  warn: {
    color: tokens.warn,
    bg: `color-mix(in oklab, ${tokens.warn} 10%, transparent)`,
    border: `color-mix(in oklab, ${tokens.warn} 40%, transparent)`,
  },
  err: {
    color: tokens.err,
    bg: `color-mix(in oklab, ${tokens.err} 10%, transparent)`,
    border: `color-mix(in oklab, ${tokens.err} 40%, transparent)`,
  },
  accent: {
    color: tokens.accent,
    bg: `color-mix(in oklab, ${tokens.accent} 10%, transparent)`,
    border: `color-mix(in oklab, ${tokens.accent} 42%, transparent)`,
  },
}

export function Page({
  children,
  maxWidth = 1440,
  style,
}: {
  children: ReactNode
  maxWidth?: number
  style?: CSSProperties
}) {
  return (
    <div
      className="fade-in"
      style={{
        width: '100%',
        maxWidth,
        boxSizing: 'border-box',
        margin: '0 auto',
        padding: '32px clamp(20px, 5vw, 40px) 48px',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  actions,
  metrics,
  style,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  metrics?: ReactNode
  style?: CSSProperties
}) {
  return (
    <header
      style={{
        display: 'grid',
        gap: 18,
        marginBottom: 28,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          {icon != null && (
            <div
              style={{
                width: 42,
                height: 42,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 8,
                border: `1px solid ${tokens.hair}`,
                background: tokens.raised,
                color: tokens.info,
                flex: '0 0 auto',
              }}
            >
              {icon}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            {eyebrow != null && <Caps>{eyebrow}</Caps>}
            <h1
              style={{
                margin: eyebrow == null ? 0 : '8px 0 0',
                fontSize: 28,
                lineHeight: 1.08,
                fontWeight: 650,
                color: tokens.strong,
                overflowWrap: 'anywhere',
              }}
            >
              {title}
            </h1>
            {subtitle != null && (
              <div style={{ marginTop: 6, color: tokens.mid, fontSize: 14, lineHeight: 1.45 }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        {actions != null && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{actions}</div>}
      </div>
      {metrics != null && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {metrics}
        </div>
      )}
    </header>
  )
}

export function MetricPill({
  label,
  value,
  tone = 'default',
  hideZero,
  title,
}: {
  label: ReactNode
  value: ReactNode
  tone?: MetricTone
  hideZero?: boolean
  title?: string
}) {
  if ((hideZero ?? tone !== 'default') && value === 0) return null
  const t = METRIC_TONES[tone]
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        minHeight: 26,
        padding: '0 9px',
        borderRadius: 7,
        border: `1px solid ${t.border}`,
        background: t.bg,
        color: t.color,
        fontFamily: tokens.mono,
        fontSize: 10.5,
        fontWeight: 650,
        textTransform: 'uppercase',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span>{value}</span>
    </span>
  )
}

export function SectionHeading({
  title,
  meta,
  action,
  level,
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  level?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  const titleTag: ElementType | undefined = level ? `h${level}` : undefined
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
        <Caps as={titleTag}>{title}</Caps>
        {meta != null && <Mono size={11} color={tokens.dim}>{meta}</Mono>}
      </div>
      {action}
    </div>
  )
}

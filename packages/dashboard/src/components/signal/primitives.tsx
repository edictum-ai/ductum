import { type CSSProperties, type ElementType, type ReactNode } from 'react'

import { tokens } from './tokens'

export function Caps({
  children,
  color,
  style,
  as,
}: {
  children: ReactNode
  color?: string
  style?: CSSProperties
  as?: ElementType
}) {
  const Tag: ElementType = as ?? 'div'
  return (
    <Tag
      style={{
        margin: 0,
        fontFamily: tokens.mono,
        fontSize: 10.5,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: color ?? tokens.dim,
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

export function Num({
  children,
  size = 44,
  color,
  weight = 400,
  tabular = true,
  style,
}: {
  children: ReactNode
  size?: number
  color?: string
  weight?: number
  tabular?: boolean
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        fontFamily: tokens.sans,
        fontSize: size,
        fontWeight: weight,
        color: color ?? tokens.fg,
        letterSpacing: -0.5,
        lineHeight: 1,
        fontVariantNumeric: tabular ? 'tabular-nums' : 'normal',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

export function Mono({
  children,
  size = 12,
  color,
  title,
  style,
}: {
  children: ReactNode
  size?: number
  color?: string
  title?: string
  style?: CSSProperties
}) {
  return (
    <span
      title={title}
      style={{
        fontFamily: tokens.mono,
        fontSize: size,
        color: color ?? tokens.mid,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {children}
    </span>
  )
}

export function Dot({
  color,
  size = 7,
  pulse,
  style,
}: {
  color: string
  size?: number
  pulse?: boolean
  style?: CSSProperties
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: color,
        display: 'inline-block',
        flexShrink: 0,
        color,
        animation: pulse ? 'sig-pulse 1.8s ease-out infinite' : 'none',
        ...style,
      }}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: tokens.mono,
        fontSize: 10,
        padding: '1.5px 6px',
        border: `1px solid ${tokens.rule}`,
        borderRadius: 4,
        color: tokens.mid,
        background: 'transparent',
      }}
    >
      {children}
    </span>
  )
}

export function Card({
  children,
  pad = 20,
  style,
  onClick,
}: {
  children: ReactNode
  pad?: number
  style?: CSSProperties
  onClick?: () => void
}) {
  return (
    <section
      onClick={onClick}
      style={{
        background: tokens.canvas,
        border: `1px solid ${tokens.hair}`,
        borderRadius: 10,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      <div style={{ padding: pad }}>{children}</div>
    </section>
  )
}

export function CardHeader({
  title,
  meta,
  action,
  tone,
  level,
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  tone?: string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  const titleTag: ElementType | undefined = level ? `h${level}` : undefined
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        paddingBottom: 14,
        marginBottom: 14,
        borderBottom: `1px solid ${tokens.hair}`,
      }}
    >
      <div>
        <Caps as={titleTag} color={tone ?? tokens.dim}>{title}</Caps>
        {meta && (
          <div
            style={{
              fontFamily: tokens.sans,
              fontSize: 13,
              color: tokens.mid,
              marginTop: 4,
            }}
          >
            {meta}
          </div>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {action}
    </div>
  )
}

export function Btn({
  children,
  primary,
  danger,
  ghost,
  small,
  disabled,
  onClick,
  type = 'button',
  style,
  title,
  'aria-label': ariaLabel,
  'data-testid': testId,
}: {
  children: ReactNode
  primary?: boolean
  danger?: boolean
  ghost?: boolean
  small?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  style?: CSSProperties
  title?: string
  'aria-label'?: string
  'data-testid'?: string
}) {
  const bg = primary
    ? tokens.accent
    : danger
      ? 'transparent'
      : ghost
        ? 'transparent'
        : tokens.raised
  const fg = primary ? '#ffffff' : danger ? tokens.err : tokens.fg
  const bd = primary
    ? tokens.accent
    : danger
      ? `color-mix(in oklab, ${tokens.err} 40%, transparent)`
      : tokens.rule
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      data-testid={testId}
      style={{
        padding: small ? '4px 10px' : '7px 14px',
        fontFamily: tokens.sans,
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        letterSpacing: -0.1,
        transition: 'opacity 120ms ease',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

/** Thin hairline divider. Horizontal by default. */
export function Divider({
  vertical,
  style,
}: {
  vertical?: boolean
  style?: CSSProperties
}) {
  if (vertical) {
    return <div style={{ width: 1, alignSelf: 'stretch', background: tokens.hair, ...style }} />
  }
  return <div style={{ height: 1, background: tokens.hair, ...style }} />
}

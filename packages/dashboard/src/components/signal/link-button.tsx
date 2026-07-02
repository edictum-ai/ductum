import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { tokens } from './tokens'

export function LinkButton({
  children,
  to,
  primary,
  danger,
  ghost,
  small,
  style,
}: {
  children: ReactNode
  to: string
  primary?: boolean
  danger?: boolean
  ghost?: boolean
  small?: boolean
  style?: CSSProperties
}) {
  const bg = primary ? tokens.accent : danger || ghost ? 'transparent' : tokens.raised
  const fg = primary ? '#ffffff' : danger ? tokens.err : tokens.fg
  const bd = primary ? tokens.accent : danger ? `color-mix(in oklab, ${tokens.err} 40%, transparent)` : tokens.rule
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: small ? '4px 10px' : '7px 14px',
        fontFamily: tokens.sans,
        fontSize: small ? 12 : 13,
        fontWeight: 500,
        background: bg,
        color: fg,
        border: `1px solid ${bd}`,
        borderRadius: 7,
        letterSpacing: -0.1,
        textDecoration: 'none',
        ...style,
      }}
    >
      {children}
    </Link>
  )
}

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { tokens } from '@/components/signal'

export function ApprovalQueueLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        border: `1px solid ${tokens.hair}`,
        borderRadius: 7,
        color: tokens.fg,
        fontSize: 13,
        padding: '7px 12px',
        textDecoration: 'none',
      }}
    >
      {children}
    </Link>
  )
}

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApprovalDecisionLine } from '@/components/approval/ApprovalDecisionLine'

describe('ApprovalDecisionLine', () => {
  it('shows explicit fallback and system actors', () => {
    render(
      <>
        <ApprovalDecisionLine
          id="d_unknown"
          decision="Approved merge"
          context="Legacy approval"
          decidedBy=""
          createdAt="2026-06-19T12:01:00.000Z"
          last={false}
        />
        <ApprovalDecisionLine
          id="d_system"
          decision="Blocked merge"
          context="Policy gate"
          decidedBy="system"
          createdAt="2026-06-19T12:02:00.000Z"
          last
        />
      </>,
    )

    expect(screen.getByText(/actor unknown/)).toBeInTheDocument()
    expect(screen.getByText(/system actor/)).toBeInTheDocument()
    expect(screen.queryByText(/^by\s*$/)).not.toBeInTheDocument()
  })
})

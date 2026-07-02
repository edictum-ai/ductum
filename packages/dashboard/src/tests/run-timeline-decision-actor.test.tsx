import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RunTimeline } from '@/pages/run-detail/run-timeline'

describe('RunTimeline decision actors', () => {
  it('shows explicit decision actor fallbacks instead of inventing ownership', () => {
    render(
      <RunTimeline
        sseStatus="connected"
        activity={[]}
        evidence={[]}
        transitions={[]}
        gates={[]}
        decisions={[{
          id: 'decision_unknown',
          specId: null,
          taskId: null,
          runId: 'run_abc123',
          decision: 'Approved merge',
          context: 'CI green',
          alternatives: null,
          decidedBy: '',
          supersedesId: null,
          createdAt: '2026-06-19T12:01:00.000Z',
        }]}
        updates={[]}
      />,
    )

    expect(screen.getByText('actor unknown')).toBeInTheDocument()
    expect(screen.queryByText(/^by\s*$/)).not.toBeInTheDocument()
  })
})

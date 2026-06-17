import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { NeedsOperatorSection } from '@/components/activity/NeedsOperatorSection'

describe('NeedsOperatorSection', () => {
  it('does not claim the brief has attention items when the reported count is clear', () => {
    render(
      <MemoryRouter>
        <NeedsOperatorSection attempts={[]} reportedCount={0} />
      </MemoryRouter>,
    )

    expect(screen.getByText('All clear · no fetched runs need operator action.')).toBeInTheDocument()
    expect(screen.queryByText(/broader factory brief reports attention items/)).not.toBeInTheDocument()
  })
})

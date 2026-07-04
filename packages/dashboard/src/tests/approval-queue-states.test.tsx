import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalQueue } from '@/pages/ApprovalQueue'
import { mockFetch, renderWithProviders } from './test-utils'

let restoreFetch: (() => void) | undefined

describe('ApprovalQueue page states', () => {
  afterEach(() => {
    restoreFetch?.()
    restoreFetch = undefined
  })

  it('renders the shared page header while loading approvals', () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}))
    restoreFetch = () => { globalThis.fetch = original }

    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByText('Loading approval queue.')).toBeInTheDocument()
    expect(screen.getByText('Loading approvals')).toBeInTheDocument()
  })

  it('renders the shared page header and recovery text when approvals fail', async () => {
    const helper = mockFetch({
      '/api/runs?stage=ship': { __status: 500, body: { error: 'queue exploded' } },
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
    })
    restoreFetch = helper.restore

    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('Queue unavailable')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByText('Approval queue unavailable.')).toBeInTheDocument()
    expect(screen.getByText(/queue exploded/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(helper.mock.mock.calls.filter(([input]) => String(input).includes('/api/runs?stage=ship'))).toHaveLength(2)
    })
  })

  it('renders the empty state with header, summary, and recovery links (not a blank card)', async () => {
    const helper = mockFetch({
      '/api/runs?stage=ship': [],
      '/api/decisions': [],
      '/api/telegram/status': { enabled: false, webhookUrl: null },
    })
    restoreFetch = helper.restore

    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    await waitFor(() => {
      expect(screen.getByText('No approval-ready attempts')).toBeInTheDocument()
    })
    // Page header is visible even on empty.
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByText(/No decisions waiting right now/)).toBeInTheDocument()
    // Metric pill renders a real value, not a blank.
    expect(screen.getByText('0')).toBeInTheDocument()
    // Empty card has a clear label and at least one recovery link.
    expect(screen.getByText(/Approve and reject controls appear here/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Factory Activity' })).toHaveAttribute('href', '/activity')
    expect(screen.getByRole('link', { name: 'Open Repair' })).toHaveAttribute('href', '/repair')
  })

  it('renders the loading state with header, summary, and a labeled card (not a blank card)', () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}))
    restoreFetch = () => { globalThis.fetch = original }

    renderWithProviders(<ApprovalQueue />, { route: '/approvals' })

    // Page header is visible immediately, not a blank card.
    expect(screen.getByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    expect(screen.getByText('Loading approval queue.')).toBeInTheDocument()
    // Loading card carries an explicit label so it cannot read as broken-empty.
    expect(screen.getByText('Loading approvals')).toBeInTheDocument()
    expect(screen.getByText('Checking attempts at ship stage.')).toBeInTheDocument()
    // Loading metric pill renders a real value, not blank.
    expect(screen.getByText('loading')).toBeInTheDocument()
  })
})

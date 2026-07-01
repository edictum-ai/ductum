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
  })
})

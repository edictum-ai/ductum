import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Settings } from '@/pages/Settings'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'
import { secretAccessEventFixture, secretMetadataFixture, typedSettingsMocks } from './settings-fixtures'

let fetchHelper: ReturnType<typeof mockFetch>

function allRenderedText(): string {
  const formValues = Array.from(document.querySelectorAll('input, textarea'))
    .map((element) => (element as HTMLInputElement).value)
    .join('\n')
  return `${document.body.textContent ?? ''}\n${formValues}`
}

// The write-only secret contract: plaintext is held in input state only until
// submit, goes out in exactly one request, and is never rendered again —
// including while the request is pending and after failed writes.
describe('Settings secrets', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    fetchHelper?.restore()
    localStorage.clear()
  })

  it('creates a secret without echoing plaintext after submit', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/factory/secrets': secretMetadataFixture({ id: 'sec_2', name: 'new-secret' }),
    }))

    renderWithProviders(<Settings />)

    const nameInput = await screen.findByTestId('secret-create-name')
    fireEvent.change(nameInput, { target: { value: 'new-secret' } })
    fireEvent.change(screen.getByTestId('secret-create-value'), { target: { value: 'super-plain-text-value' } })
    fireEvent.click(screen.getByTestId('secret-create-submit'))

    // Plaintext leaves rendered state at submit time — before the request
    // resolves, not only on success.
    expect(screen.getByTestId('secret-create-value')).toHaveValue('')

    await waitFor(() => {
      expect(screen.getByTestId('secrets-status')).toHaveTextContent('write-only')
    })

    const postCalls = callsOf(fetchHelper, 'POST', '/api/factory/secrets')
    expect(postCalls).toHaveLength(1)
    expect(requestBody(postCalls[0] as [RequestInfo, RequestInit])).toEqual({ name: 'new-secret', value: 'super-plain-text-value' })

    expect(screen.getByTestId('secret-create-value')).toHaveValue('')
    expect(allRenderedText()).not.toContain('super-plain-text-value')
  })

  it('keeps plaintext out of rendered state when a secret write fails', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'POST /api/factory/secrets': { __status: 400, body: { error: 'name is required' } },
      'PATCH /api/factory/secrets/sec_1': { __status: 500, body: { error: 'encryption unavailable' } },
    }))

    renderWithProviders(<Settings />)

    // Failed create: input stays cleared, error is shown, no plaintext anywhere.
    const nameInput = await screen.findByTestId('secret-create-name')
    fireEvent.change(nameInput, { target: { value: 'broken-secret' } })
    fireEvent.change(screen.getByTestId('secret-create-value'), { target: { value: 'failed-create-plaintext' } })
    fireEvent.click(screen.getByTestId('secret-create-submit'))

    expect(screen.getByTestId('secret-create-value')).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByTestId('secrets-status')).toHaveTextContent('name is required')
    })

    // Failed rotate: the inline input stays open for a retry but is empty.
    fireEvent.click(await screen.findByTestId('secret-rotate-anthropic-api-key'))
    fireEvent.change(screen.getByTestId('secret-rotate-input'), { target: { value: 'failed-rotate-plaintext' } })
    fireEvent.click(screen.getByTestId('secret-rotate-confirm'))

    expect(screen.getByTestId('secret-rotate-input')).toHaveValue('')
    await waitFor(() => {
      expect(screen.getByTestId('secrets-status')).toHaveTextContent('encryption unavailable')
    })

    expect(allRenderedText()).not.toContain('failed-create-plaintext')
    expect(allRenderedText()).not.toContain('failed-rotate-plaintext')
  })

  it('rotates, tests, and deletes a secret through the typed secret APIs', async () => {
    let secretRows = [secretMetadataFixture()]
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/factory/secrets': () => secretRows,
      'PATCH /api/factory/secrets/sec_1': secretMetadataFixture({ lastRotatedAt: '2026-06-11T08:00:00.000Z' }),
      'POST /api/factory/secrets/sec_1/test': secretMetadataFixture({ lastTestedAt: '2026-06-11T08:00:00.000Z' }),
      'DELETE /api/factory/secrets/sec_1': () => {
        secretRows = []
        return { __status: 204 }
      },
    }))

    renderWithProviders(<Settings />)

    // Rotate: plaintext leaves rendered state at submit, input collapses after success.
    fireEvent.click(await screen.findByTestId('secret-rotate-anthropic-api-key'))
    fireEvent.change(screen.getByTestId('secret-rotate-input'), { target: { value: 'rotated-plain-value' } })
    fireEvent.click(screen.getByTestId('secret-rotate-confirm'))
    expect(screen.getByTestId('secret-rotate-input')).toHaveValue('')
    await waitFor(() => {
      expect(screen.queryByTestId('secret-rotate-input')).toBeNull()
    })
    const rotateCalls = callsOf(fetchHelper, 'PATCH', '/api/factory/secrets/sec_1')
    expect(rotateCalls).toHaveLength(1)
    expect(requestBody(rotateCalls[0] as [RequestInfo, RequestInit])).toEqual({ value: 'rotated-plain-value' })
    expect(allRenderedText()).not.toContain('rotated-plain-value')

    // Test: hits the typed test route.
    fireEvent.click(screen.getByTestId('secret-test-anthropic-api-key'))
    await waitFor(() => {
      expect(callsOf(fetchHelper, 'POST', '/api/factory/secrets/sec_1/test')).toHaveLength(1)
    })

    // Delete: two-step confirm, then the row leaves the list.
    fireEvent.click(screen.getByTestId('secret-delete-anthropic-api-key'))
    fireEvent.click(screen.getByTestId('secret-delete-anthropic-api-key'))
    await waitFor(() => {
      expect(screen.queryByTestId('secret-row-anthropic-api-key')).toBeNull()
    })
    expect(callsOf(fetchHelper, 'DELETE', '/api/factory/secrets/sec_1')).toHaveLength(1)
  })

  it('shows recent secret access history without exposing values', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/factory/secrets/sec_1/access-history': [
        secretAccessEventFixture({
          runId: 'run_secret1',
          agentId: 'agent_atlas',
          outcome: 'failure',
          errorMessage: 'provider rejected sk-ant-secret-value',
        }),
      ],
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByText('Recent access')).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'run run_se' })).toHaveAttribute('href', '/runs/run_secret1')
      expect(screen.getByText('agent agent_')).toBeInTheDocument()
    })

    expect(allRenderedText()).not.toContain('super-secret-value')
    expect(allRenderedText()).not.toContain('sk-ant-secret-value')
    expect(allRenderedText()).not.toContain('ciphertext')
    expect(allRenderedText()).not.toContain('encryptedPayload')
  })

  it('does not present access-history load failures as empty history', async () => {
    fetchHelper = mockFetch(typedSettingsMocks({
      'GET /api/factory/secrets/sec_1/access-history': {
        __status: 500,
        body: { error: 'history unavailable' },
      },
    }))

    renderWithProviders(<Settings />)

    await waitFor(() => {
      expect(screen.getByText(/Access history unavailable/)).toBeInTheDocument()
    })
    expect(screen.queryByText('No access events recorded yet.')).not.toBeInTheDocument()
  })
})

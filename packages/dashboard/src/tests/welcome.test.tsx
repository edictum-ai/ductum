import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from '@/App'
import { mockFetch, renderWithProviders } from './test-utils'

const FACTORY = {
  id: 'factory_1',
  name: 'Demo Factory',
  config: { heartbeatTimeoutSeconds: 300, defaultMergeMode: 'squash' },
  createdAt: '2026-05-03T00:00:00.000Z',
}

const PROJECT = {
  id: 'project_1',
  factoryId: 'factory_1',
  name: 'demo',
  repos: ['.'],
  config: { mergeMode: 'squash', workflowPath: '' },
  createdAt: '2026-05-03T00:00:00.000Z',
  updatedAt: '2026-05-03T00:00:00.000Z',
}

const AGENT = {
  id: 'agent_1',
  name: 'codex',
  model: 'gpt-5.4',
  harness: 'codex-sdk',
  capabilities: ['build'],
  costTier: 1,
  spawnConfig: {},
  createdAt: '2026-05-03T00:00:00.000Z',
}

let fetchHelper: ReturnType<typeof mockFetch>
const originalMatchMedia = window.matchMedia

describe('Welcome route', () => {
  beforeEach(() => {
    localStorage.clear()
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('768px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    fetchHelper?.restore()
    vi.restoreAllMocks()
    window.matchMedia = originalMatchMedia
  })

  it('strips the pairing code before exchanging it for the cookie session', async () => {
    window.history.pushState(null, '', '/welcome?pair=handoff_secret')
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    fetchHelper = mockFetch({
      '/api/internal/welcome/exchange': {
        schemaVersion: 1,
        kind: 'welcome.handoff_exchanged',
        data: { ok: true, factoryId: 'factory_1', expiresAt: '2026-05-03T00:01:00.000Z' },
        ts: '2026-05-03T00:00:00.000Z',
      },
      '/api/factory': FACTORY,
      '/api/projects/project_1/specs': [],
      '/api/projects': [PROJECT],
      '/api/agents': [AGENT],
    })

    renderWithProviders(<App />, { route: '/welcome?pair=handoff_secret' })

    await waitFor(() => {
      expect(fetchHelper.mock).toHaveBeenCalledWith(
        expect.stringContaining('/api/internal/welcome/exchange'),
        expect.objectContaining({ method: 'POST' }),
      )
    })
    const exchangeCall = fetchHelper.mock.mock.calls.find(([url]) =>
      String(url).includes('/api/internal/welcome/exchange'),
    )
    expect(JSON.parse(String(exchangeCall?.[1]?.body))).toEqual({ token: 'handoff_secret' })
    expect(exchangeCall?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(exchangeCall?.[1]?.credentials).toBe('same-origin')
    expect(replaceSpy.mock.calls[0]?.[2]).toBe('/welcome')
    expect(window.location.search).toBe('')

    await waitFor(() => {
      expect(screen.getByText('Dashboard paired.')).toBeInTheDocument()
      expect(screen.getByText('Factory is running.')).toBeInTheDocument()
    })
    expect(document.body).not.toHaveTextContent('handoff_secret')
    expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
    expect(document.cookie).not.toContain('operator')
  })

  it('does not call the handoff endpoint when opened without a browser handoff', async () => {
    window.history.pushState(null, '', '/welcome')
    fetchHelper = mockFetch({
      '/api/factory': FACTORY,
      '/api/projects/project_1/specs': [],
      '/api/projects': [PROJECT],
      '/api/agents': [AGENT],
    })

    renderWithProviders(<App />, { route: '/welcome' })

    await waitFor(() => {
      expect(screen.getByText('Import your first spec')).toBeInTheDocument()
      expect(screen.getByText('Dispatch a sample task')).toBeInTheDocument()
    })
    expect(fetchHelper.mock.mock.calls.some(([url]) => String(url).includes('/welcome/exchange'))).toBe(false)
    expect(document.querySelectorAll('[src^="http"],[href^="http"]').length).toBe(0)
  })

  it('keeps manually opened protected sessions free of token UX', async () => {
    window.history.pushState(null, '', '/welcome')
    fetchHelper = mockFetch({
      '/api/health': { ok: true, operatorTokenProtected: true },
      '/api/factory': { __status: 401, body: { error: 'Operator token required' } },
      '/api/projects': { __status: 401, body: { error: 'Operator token required' } },
      '/api/agents': { __status: 401, body: { error: 'Operator token required' } },
    })

    renderWithProviders(<App />, { route: '/welcome' })

    await waitFor(() => {
      expect(screen.getByText('Factory is running.')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('token-banner')).not.toBeInTheDocument()
    expect(screen.queryByText(/operator token|required|session settings|try reconnect/i)).not.toBeInTheDocument()
  })

  it('shows an expired-link state without leaking the token', async () => {
    window.history.pushState(null, '', '/welcome?pair=expired_secret')
    fetchHelper = mockFetch({
      '/api/internal/welcome/exchange': { __status: 410, body: { error: { code: 'welcome.handoff_invalid' } } },
      '/api/factory': FACTORY,
      '/api/projects/project_1/specs': [],
      '/api/projects': [PROJECT],
      '/api/agents': [AGENT],
    })

    renderWithProviders(<App />, { route: '/welcome?pair=expired_secret' })

    await waitFor(() => {
      expect(screen.getByText(/Pairing link expired/)).toBeInTheDocument()
    })
    expect(window.location.search).toBe('')
    expect(document.body).not.toHaveTextContent('expired_secret')
    expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
  })

  it('creates the welcome sample as an API import without exposing auth material', async () => {
    window.history.pushState(null, '', '/welcome')
    fetchHelper = mockFetch({
      '/api/factory': FACTORY,
      '/api/projects/project_1/specs/import': {
        spec: { id: 'spec_1', projectId: 'project_1', name: 'hello-readme', status: 'approved', document: '', createdAt: '', updatedAt: '' },
        taskCount: 1,
      },
      '/api/welcome/sample-spec': {
        schemaVersion: 1,
        kind: 'welcome.sample_spec',
        ts: '2026-05-03T00:00:00.000Z',
        data: {
          source: { name: 'hello-readme', path: '/package/assets/specs/examples/hello-readme' },
          spec: { name: 'hello-readme', status: 'approved', document: '# hello-readme' },
          tasks: [{
            name: 'append-readme-line',
            prompt: 'Append the line `Bootstrap proof: hello from Ductum.` to `README.md`.',
            repos: ['.'],
            verification: ['git diff -- README.md', 'tail -n 5 README.md'],
          }],
        },
      },
      '/api/projects/project_1/specs': [],
      '/api/projects': [PROJECT],
      '/api/agents': [AGENT],
    })

    renderWithProviders(<App />, { route: '/welcome' })
    const createButton = await screen.findByRole('button', { name: 'Create Sample' })
    await waitFor(() => {
      expect(createButton).not.toBeDisabled()
    })
    fireEvent.click(createButton)

    await waitFor(() => {
      expect(screen.getByText('Sample task created. Open Projects to review or dispatch it.')).toBeInTheDocument()
    })
    const importCall = fetchHelper.mock.mock.calls.find(([url]) =>
      String(url).includes('/api/projects/project_1/specs/import'),
    )
    const body = JSON.parse(String(importCall?.[1]?.body))
    expect(body.spec.name).toBe('hello-readme')
    expect(body.spec.document).toBe('# hello-readme')
    expect(body.tasks[0].name).toBe('append-readme-line')
    expect(body.tasks[0].prompt).toContain('Bootstrap proof')
    expect(document.body).not.toHaveTextContent('operator-token')
    expect(localStorage.getItem('ductum.operatorToken')).toBeNull()
  })
})

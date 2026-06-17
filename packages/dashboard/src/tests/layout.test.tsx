import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'

import { Layout } from '@/components/Layout'
import { layoutApiResponses, operatorBrief, repairReport, run } from './command-palette-test-data'
import { mockFetch } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch>

/**
 * Override matchMedia to simulate a desktop viewport so Layout renders
 * the desktop sidebar + top breadcrumb bar instead of the mobile nav.
 */
function enableDesktopViewport() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(min-width: 768px)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

function renderLayout(route: string) {
  enableDesktopViewport()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  function DummyPage() {
    return <div data-testid="outlet-content">Page content</div>
  }
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DummyPage />} />
              <Route path="projects" element={<DummyPage />} />
              <Route path="activity" element={<DummyPage />} />
              <Route path="repair" element={<DummyPage />} />
              <Route path="specs" element={<DummyPage />} />
              <Route path="specs/:specId" element={<DummyPage />} />
              <Route path="agents" element={<DummyPage />} />
              <Route path="approvals" element={<DummyPage />} />
              <Route path="settings" element={<DummyPage />} />
              <Route path=":project" element={<DummyPage />} />
              <Route path=":project/:spec" element={<DummyPage />} />
              <Route path=":project/:spec/:task" element={<DummyPage />} />
              <Route path=":project/:spec/:task/:runId" element={<DummyPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  fetchHelper?.restore()
})

describe('Breadcrumb navigation', () => {
  it('renders clickable parent crumbs with keyboard affordances', async () => {
    fetchHelper = mockFetch({})
    renderLayout('/specs/my-spec')

    await waitFor(() => {
      expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
    })

    const projectsLink = screen.getByLabelText('Navigate to Projects')
    expect(projectsLink).toBeInTheDocument()
    expect(projectsLink.tagName).toBe('A')
    expect(projectsLink).toHaveAttribute('href', '/projects')

    const specsLink = screen.getByLabelText('Navigate to Legacy specs')
    expect(specsLink).toBeInTheDocument()
    expect(specsLink).toHaveAttribute('href', '/specs')

    // The final segment ("my-spec") should NOT be a link
    const currentCrumb = screen.getByText('my-spec')
    expect(currentCrumb.tagName).toBe('SPAN')
    expect(currentCrumb).toHaveAttribute('aria-current', 'page')
  })

  it('shows hover styling on parent crumbs', async () => {
    fetchHelper = mockFetch({})
    renderLayout('/settings')

    await waitFor(() => {
      expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
    })

    const factoryLink = screen.getByLabelText('Navigate to Factory')
    fireEvent.mouseEnter(factoryLink)
    expect(factoryLink.style.background).not.toBe('')
    fireEvent.mouseLeave(factoryLink)
  })

  it('shows focus ring on keyboard navigation', async () => {
    fetchHelper = mockFetch({})
    renderLayout('/agents')

    await waitFor(() => {
      expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
    })

    const settingsLink = screen.getByLabelText('Navigate to Factory Settings')
    fireEvent.focus(settingsLink)
    // The focus handler sets boxShadow to `0 0 0 2px ${tokens.accent}`
    expect(settingsLink.style.boxShadow).toContain('2px')
    fireEvent.blur(settingsLink)
    // The blur handler clears the focus ring
    expect(settingsLink.style.boxShadow).not.toContain('2px')
  })

  it('marks the final crumb as the current page', async () => {
    fetchHelper = mockFetch({})
    renderLayout('/approvals')

    await waitFor(() => {
      expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
    })

    // Scope to breadcrumb nav to avoid matching sidebar nav items
    const nav = screen.getByLabelText('Breadcrumb')
    const approvalsCrumb = within(nav).getByText('Approvals')
    expect(approvalsCrumb).toHaveAttribute('aria-current', 'page')
    expect(approvalsCrumb.tagName).toBe('SPAN')
  })

  it('wraps breadcrumbs in a nav with aria-label', async () => {
    fetchHelper = mockFetch({})
    renderLayout('/')

    await waitFor(() => {
      expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument()
    })
  })

  it('opens the command palette from the top search button', async () => {
    fetchHelper = mockFetch(layoutApiResponses({
      runs: [
        run({ id: 'failed123456', taskName: 'repair-memory', specName: 'P0', projectName: 'ductum', terminalState: 'failed', failReason: 'tests failed' }),
      ],
      brief: operatorBrief({ readyTasks: 2, needsOperator: 1 }),
      repair: repairReport({ total: 3, blockers: 1, attention: 2 }),
      search: {
        '/api/search?q=qratum': [
          {
            type: 'decision',
            id: 'dec_1',
            name: 'Imported Decision Trace: qratum',
            subtitle: 'qratum · milestone-a-dispatch',
            url: '/qratum/milestone-a-dispatch',
          },
        ],
      },
    }))
    renderLayout('/')

    fireEvent.click(screen.getByRole('button', { name: /search actions, projects, specs, tasks, attempts/i }))

    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByText('Inspect blocked attempt: repair-memory')).toBeInTheDocument()
    })
    expect(within(dialog).getByText('retry · 1')).toBeInTheDocument()
    expect(within(dialog).getByText('Dispatch 2 ready tasks')).toBeInTheDocument()
    expect(within(dialog).getByText('Repair 1 factory blockers')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/decisions/i), { target: { value: 'qratum' } })

    await waitFor(() => {
      expect(within(dialog).getByText('Imported Decision Trace: qratum')).toBeInTheDocument()
    })
    expect(within(dialog).getByText('qratum · milestone-a-dispatch')).toBeInTheDocument()
    expect(within(dialog).getByText('decision')).toBeInTheDocument()
  })

  it('opens operator actions from the command palette', async () => {
    fetchHelper = mockFetch(layoutApiResponses({
      runs: [
        run({ id: 'failed123456', taskName: 'repair-memory', specName: 'P0', projectName: 'ductum', terminalState: 'failed', failReason: 'tests failed' }),
      ],
      brief: operatorBrief({ needsOperator: 1 }),
    }))
    renderLayout('/')

    fireEvent.click(screen.getByRole('button', { name: /search actions, projects, specs, tasks, attempts/i }))
    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByText('Inspect blocked attempt: repair-memory')).toBeInTheDocument()
    })
    fireEvent.click(within(dialog).getByText('Inspect blocked attempt: repair-memory'))

    await waitFor(() => {
      expect(within(screen.getByLabelText('Breadcrumb')).getByText('Attempt failed')).toBeInTheDocument()
    })
  })

  it('keeps matching operator actions ahead of search hits on Enter', async () => {
    fetchHelper = mockFetch(layoutApiResponses({
      runs: [
        run({ id: 'retry123456', taskName: 'retry-payment-flow', specName: 'P1', projectName: 'ductum', terminalState: 'stalled', blockedReason: 'heartbeat timeout' }),
      ],
      brief: operatorBrief({ needsOperator: 1 }),
      search: {
        '/api/search?q=retry': [
          {
            type: 'run',
            id: 'search_run',
            name: 'Retry search hit',
            subtitle: 'ductum · P2',
            url: '/ductum/P2/search-hit/search',
          },
        ],
      },
    }))
    renderLayout('/')

    fireEvent.click(screen.getByRole('button', { name: /search actions, projects, specs, tasks, attempts/i }))
    const dialog = screen.getByRole('dialog')
    const input = screen.getByPlaceholderText(/attempts/i)
    fireEvent.change(input, { target: { value: 'retry' } })

    await waitFor(() => {
      expect(within(dialog).getByText('Retry search hit')).toBeInTheDocument()
    })
    expect(within(dialog).getByText('Inspect blocked attempt: retry-payment-flow')).toBeInTheDocument()

    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(within(screen.getByLabelText('Breadcrumb')).getByText('Attempt retry1')).toBeInTheDocument()
    })
  })

  it('labels search run results as attempts', async () => {
    fetchHelper = mockFetch(layoutApiResponses({
      search: {
        '/api/search?q=ship': [
          {
            type: 'run',
            id: 'run_1',
            name: 'Ship try',
            subtitle: 'ductum · P7B · task',
            url: '/ductum/P7B/task/run_1',
          },
        ],
      },
    }))
    renderLayout('/')

    fireEvent.click(screen.getByRole('button', { name: /search actions, projects, specs, tasks, attempts/i }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(screen.getByPlaceholderText(/attempts/i), { target: { value: 'ship' } })

    await waitFor(() => {
      expect(within(dialog).getByText('Ship try')).toBeInTheDocument()
    })
    expect(within(dialog).getByText('attempt')).toBeInTheDocument()
    expect(within(dialog).queryByText('run')).not.toBeInTheDocument()
  })

  it('shows the P7B primary navigation without legacy primary labels', async () => {
    fetchHelper = mockFetch({ '/api/runs?stage=ship': [], '/api/runs?limit=200': [] })
    renderLayout('/')

    await waitFor(() => {
      expect(screen.getByTestId('outlet-content')).toBeInTheDocument()
    })

    const nav = screen.getByRole('navigation', { name: 'Primary' })
    expect(within(nav).getByRole('link', { name: /Home/ })).toHaveAttribute('href', '/')
    expect(within(nav).getByRole('link', { name: /Projects/ })).toHaveAttribute('href', '/projects')
    expect(within(nav).getByRole('link', { name: /Factory Activity/ })).toHaveAttribute('href', '/activity')
    expect(within(nav).getByRole('link', { name: /Approvals/ })).toHaveAttribute('href', '/approvals')
    expect(within(nav).getByRole('link', { name: /Factory Settings/ })).toHaveAttribute('href', '/settings')
    expect(within(nav).getByRole('link', { name: /Repair/ })).toHaveAttribute('href', '/repair')

    expect(within(nav).queryByRole('link', { name: /Specs/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Agents/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Resources/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Runs/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Targets/ })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: /Seed/ })).not.toBeInTheDocument()
  })
})

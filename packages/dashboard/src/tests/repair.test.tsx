import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Repair } from '@/pages/Repair'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

function mockRepair(report: unknown, projects: unknown[] = []) {
  return mockFetch({
    '/api/repair': report,
    '/api/projects': projects,
  })
}

function repairReport(items: unknown[]) {
  const groups = [
    group('factory_setup', 'Factory setup', items),
    group('agent_readiness', 'Agent readiness', items),
    group('attempt_recovery', 'Attempt recovery', items),
  ].filter((item) => item.items.length > 0)
  return {
    generatedAt: '2026-06-09T12:00:00.000Z',
    items,
    groups,
    summary: {
      total: items.length,
      blockers: items.filter((item: any) => item.severity === 'blocker').length,
      attention: items.filter((item: any) => item.severity === 'attention').length,
      byArea: {
        factory_setup: items.filter((item: any) => item.area === 'factory_setup').length,
        project_readiness: 0,
        repository_readiness: 0,
        agent_readiness: items.filter((item: any) => item.area === 'agent_readiness').length,
        provider_auth: 0,
        workflow_validity: 0,
        spec_start: 0,
        attempt_recovery: items.filter((item: any) => item.area === 'attempt_recovery').length,
        migration: 0,
      },
    },
    projectDispatch: [],
  }
}

function group(area: string, label: string, items: unknown[]) {
  return {
    area,
    label,
    blocks: `${label} blocks`,
    items: items.filter((item: any) => item.area === area),
  }
}

function item(overrides: Record<string, unknown>) {
  return {
    id: 'item-1',
    area: 'attempt_recovery',
    severity: 'attention',
    title: 'Linked commit has no execution lineage',
    reason: 'This attempt references a commit but has no Ductum lineage.',
    suggestedAction: 'Record an external outcome.',
    record: { type: 'Attempt', id: 'run_def456', name: 'run_de' },
    field: { path: 'attempts.run_def456.evidence', label: 'commit lineage', value: '(missing)' },
    blocks: 'Attempts that stopped or recorded inconsistent execution.',
    status: 'unknown',
    issueCode: 'linked_commit_without_lineage',
    target: { projectName: 'qratum', specName: 'milestone-a', taskName: 'P1-BUILD', attemptId: 'run_def456' },
    href: '/qratum/milestone-a/P1-BUILD/run_de',
    linkLabel: 'Open attempt',
    ...overrides,
  }
}

const REPAIR_ITEMS = [
  item({
    id: 'factory:dispatcher-disabled',
    area: 'factory_setup',
    severity: 'blocker',
    title: 'Dispatcher is disabled',
    suggestedAction: 'Restart the Ductum API with dispatch enabled so ready tasks auto-dispatch.',
    record: { type: 'Factory', id: null, name: 'Ductum' },
    field: { path: 'factory.dispatch.enabled', label: 'Factory Activity dispatch', value: 'false' },
    issueCode: null,
    target: null,
    href: '/settings',
    linkLabel: 'Open app settings',
  }),
  item({
    id: 'factory:no-agents',
    area: 'agent_readiness',
    severity: 'blocker',
    title: 'No agents are registered',
    suggestedAction: 'Add an agent in Factory Settings, then assign it to a project.',
    record: { type: 'Factory', id: null, name: 'Factory agents' },
    field: { path: 'factory.agents', label: 'Agent roster', value: '0' },
    issueCode: null,
    target: null,
  }),
  item({
    id: 'task:t1:done_task_without_lineage_or_external_outcome',
    title: 'Completed task has no traceable attempt',
    issueCode: 'done_task_without_lineage_or_external_outcome',
    record: { type: 'Task', id: 't1', name: 'P1-BUILD' },
    field: { path: 'tasks.t1.evidence', label: 'execution lineage / external-outcome evidence', value: '(missing)' },
    target: { projectName: 'qratum', specName: 'milestone-a', taskName: 'P1-BUILD' },
    href: '/qratum/milestone-a/P1-BUILD',
    linkLabel: 'Open task',
  }),
  item({ id: 'attempt:run_def456:linked_commit_without_lineage' }),
]

describe('Repair page', () => {
  it('renders grouped repair sections from brief + integrity data', async () => {
    fetchHelper = mockRepair(repairReport(REPAIR_ITEMS))

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Dispatcher is disabled')).toBeInTheDocument()
    })
    // Grouped sections by what they block.
    expect(screen.getAllByText('Factory setup').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Agent readiness').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Attempt recovery').length).toBeGreaterThan(0)
    // Items carry human labels and a suggested action.
    expect(screen.getByText('No agents are registered')).toBeInTheDocument()
    expect(screen.getByText('Completed task has no traceable attempt')).toBeInTheDocument()
    expect(screen.getByText('Linked commit has no execution lineage')).toBeInTheDocument()
    expect(screen.getByText(/Add an agent in Factory Settings/)).toBeInTheDocument()
  })

  it('renders grouped items from the canonical Repair API contract', async () => {
    const providerItem = item({
      id: 'provider:openai:auth:missing',
      area: 'provider_auth',
      title: 'OpenAI auth is missing',
      reason: 'OpenAI auth was not detected.',
      suggestedAction: 'Open Factory Settings and configure provider auth.',
      record: { type: 'Provider', id: 'provider:openai', name: 'OpenAI' },
      field: { path: 'providers.openai.auth', label: 'Provider auth', value: '(missing)' },
      blocks: 'Blocks agents whose provider is not authenticated.',
      issueCode: null,
      target: null,
    })
    const report = repairReport([REPAIR_ITEMS[0]])
    report.groups = [{
      area: 'provider_auth',
      label: 'Provider auth',
      blocks: 'Blocks agents whose provider is not authenticated.',
      items: [providerItem],
    }]
    fetchHelper = mockRepair(report)

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('OpenAI auth is missing')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Provider auth').length).toBeGreaterThan(0)
    expect(screen.queryByText('Dispatcher is disabled')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/\bRun\b|\bTarget\b|\bResources\b|\bseed\b/i)
  })

  it('does not show the raw issue code as the primary label', async () => {
    fetchHelper = mockRepair(repairReport(REPAIR_ITEMS.slice(2)))

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Completed task has no traceable attempt')).toBeInTheDocument()
    })
    // Raw enum codes never appear as a standalone primary label.
    expect(screen.queryByText('done_task_without_lineage_or_external_outcome')).not.toBeInTheDocument()
    expect(screen.queryByText('linked_commit_without_lineage')).not.toBeInTheDocument()
  })

  it('uses Attempt, not Run, for execution tries', async () => {
    fetchHelper = mockRepair(repairReport([REPAIR_ITEMS[3]]))

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Linked commit has no execution lineage')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Attempt run_def456/).length).toBeGreaterThan(0)
    // No raw "run"-worded enum messages leak into the normal surface.
    expect(screen.queryByText(/Ductum run/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Run')).not.toBeInTheDocument()
  })

  it('links repair items to exact records when ids/names are present', async () => {
    fetchHelper = mockRepair(repairReport(REPAIR_ITEMS.slice(2)))

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Linked commit has no execution lineage')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /Open attempt/i })).toHaveAttribute('href', '/qratum/milestone-a/P1-BUILD/run_de')
    expect(screen.getByRole('link', { name: /Open task/i })).toHaveAttribute('href', '/qratum/milestone-a/P1-BUILD')
  })

  it('gives next actions on an empty repair page instead of a dead placeholder', async () => {
    fetchHelper = mockRepair(repairReport([]), [])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('No repair items right now')).toBeInTheDocument()
    })
    expect(screen.getByText(/No current setup, readiness, or execution-integrity repair items are visible here/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/last issue|last attention|last repaired|resolved/i)
    expect(screen.queryByText('clear')).not.toBeInTheDocument()
    expect(screen.getAllByText('none visible').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Add your first project/i })).toHaveAttribute('href', '/projects')
    expect(screen.getByRole('link', { name: /Factory Activity/i })).toHaveAttribute('href', '/activity')
    expect(screen.getByRole('link', { name: /Factory Settings/i })).toHaveAttribute('href', '/settings')
    // The P7B placeholder must be gone.
    expect(screen.queryByText(/Repair detail views are not implemented yet/i)).not.toBeInTheDocument()
  })

  it('renders a labeled loading branch (not the empty state) while /api/repair is in flight', () => {
    const original = globalThis.fetch
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}))
    fetchHelper = { mock: globalThis.fetch as unknown as ReturnType<typeof mockFetch>['mock'], restore: () => { globalThis.fetch = original } }

    renderWithProviders(<Repair />, { route: '/repair' })

    // Page header is rendered immediately so the page never looks blank.
    expect(screen.getByRole('heading', { name: 'Repair' })).toBeInTheDocument()
    // Loading card carries an explicit label naming the kinds of checks being read.
    expect(screen.getByText('Reading repair report')).toBeInTheDocument()
    expect(screen.getByText(/Setup, readiness, and execution-integrity checks/)).toBeInTheDocument()
    // The empty-state copy is NOT rendered while loading.
    expect(screen.queryByText('No repair items right now')).not.toBeInTheDocument()
    expect(screen.queryByText(/No current setup, readiness, or execution-integrity repair items are visible here/)).not.toBeInTheDocument()
    // Loading metric pill renders a real value, not blank.
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('renders a labeled error branch with retry (not the empty state) when /api/repair fails', async () => {
    const helper = mockFetch({
      '/api/repair': { __status: 500, body: 'repair service offline' },
      '/api/projects': [],
    })
    fetchHelper = helper

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Repair report unavailable')).toBeInTheDocument()
    })
    // Page header still renders so the surface is recognizable.
    expect(screen.getByRole('heading', { name: 'Repair' })).toBeInTheDocument()
    expect(screen.getByText('Repair report unavailable.')).toBeInTheDocument()
    // The actual API failure text reaches the operator.
    expect(screen.getByText(/repair service offline/)).toBeInTheDocument()
    // Retry button is wired to refetch().
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    await waitFor(() => {
      expect(helper.mock.mock.calls.filter(([input]) => String(input).includes('/api/repair')).length).toBeGreaterThan(1)
    })
    // The empty-state copy is NOT rendered during an error.
    expect(screen.queryByText('No repair items right now')).not.toBeInTheDocument()
    expect(screen.queryByText(/No current setup, readiness, or execution-integrity repair items are visible here/)).not.toBeInTheDocument()
  })
})

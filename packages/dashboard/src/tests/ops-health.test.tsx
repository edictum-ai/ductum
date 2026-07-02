import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { OpsHealth } from '@/pages/OpsHealth'
import type { OpsHealthReport } from '@/api/client'
import { callsOf, mockFetch, renderWithProviders, requestBody } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

const healthyReport: OpsHealthReport = {
  generatedAt: '2026-07-02T08:00:00.000Z',
  status: 'ready',
  process: {
    status: 'ready',
    apiBindHost: '127.0.0.1',
    apiPort: 4100,
    publicApiUrl: null,
    dashboardUrl: 'http://127.0.0.1:4100',
    dbPath: '/tmp/factory/ductum.db',
    factoryDataDir: '/tmp/factory',
    uptimeSeconds: 3600,
    dispatcher: {
      enabled: true,
      running: true,
      activeRuns: 2,
      maxConcurrentRuns: 3,
      lastCycleAt: '2026-07-02T07:59:30Z',
      adapterCount: 1,
      adapters: ['codex-sdk'],
      reason: null,
    },
  },
  doctor: { status: 'ready', summary: { ready: 2, blocked: 0, deferred: 0 } },
  database: {
    path: '/tmp/factory/ductum.db',
    exists: true,
    sizeBytes: 524288,
    factoryState: 'has_factory',
    schema: {
      binarySchemaVersion: 51,
      onDiskSchemaVersion: 51,
      appliedSchemaVersion: 51,
      appliedMigrationIds: ['001_init', '051_audit_events'],
      unknownMigrationIds: [],
      headMigrationId: '051_audit_events',
      current: true,
    },
    backupRestore: {
      available: false,
      reason: 'No backup/restore primitive exists in this build; restore flows must come from OS-level snapshots.',
    },
  },
  worktrees: {
    enabled: true,
    basePath: '/tmp/factory/.ductum/worktrees',
    totalBytes: 48238,
    measurable: true,
    directoryCount: 2,
    entries: [
      {
        path: '/tmp/factory/.ductum/worktrees/ductum/p1-ops-AAAAAA/ductum',
        project: 'ductum',
        taskDir: 'p1-ops-AAAAAA',
        shortId: 'AAAAAA',
        exists: true,
        accessible: true,
        bytes: 32768,
        mtimeMs: Date.parse('2026-07-02T07:00:00Z'),
      },
      {
        path: '/tmp/factory/.ductum/worktrees/ductum/p2-missing-BBBBBB/ductum',
        project: 'ductum',
        taskDir: 'p2-missing-BBBBBB',
        shortId: 'BBBBBB',
        exists: false,
        accessible: false,
        bytes: null,
        mtimeMs: null,
      },
    ],
    error: null,
  },
  logs: {
    available: true,
    recent: [
      {
        id: 'evt-1',
        source: 'audit_event',
        sourceId: 'evt-1',
        occurredAt: '2026-07-02T08:00:00Z',
        actor: 'operator',
        projectId: null,
        projectName: null,
        specId: null,
        specName: null,
        taskId: null,
        taskName: null,
        runId: null,
        eventType: 'ops.cleanup_worktrees',
        status: 'success',
        title: 'Worktree cleanup completed',
        summary: 'Removed 3 inactive worktree directory(ies).',
        metadata: {},
      },
    ],
  },
}

describe('OpsHealth page', () => {
  it('renders the operator status surface from /api/factory/ops-health', async () => {
    fetchHelper = mockFetch({
      '/api/factory/ops-health': healthyReport,
    })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })

    await waitFor(() => {
      expect(screen.getByText('Process & dispatcher')).toBeInTheDocument()
    })
    expect(screen.getByText('Worktree inventory')).toBeInTheDocument()
    expect(screen.getByText('Database')).toBeInTheDocument()
    expect(screen.getByText('Recent operational logs')).toBeInTheDocument()
    expect(screen.getByText('Cleanup worktrees')).toBeInTheDocument()
    // Header pills surface the aggregated status, dispatcher, worktree count, disk total, and doctor summary.
    expect(screen.getAllByText('ready').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2/).length).toBeGreaterThan(0) // worktree count + active runs
    expect(screen.getAllByText('running').length).toBeGreaterThan(0)
    // Worktree rows show short id + bytes.
    expect(screen.getByText('AAAAAA')).toBeInTheDocument()
    expect(screen.getByText('BBBBBB')).toBeInTheDocument()
    // The missing entry surfaces a 'missing' badge so operators see deletion clearly.
    expect(screen.getByText('missing')).toBeInTheDocument()
    // DB schema current is explicit.
    expect(screen.getAllByText(/current \(v51\)/).length).toBeGreaterThan(0)
    // Backup unavailable is explicit, not a placeholder.
    expect(screen.getAllByText(/No backup\/restore primitive/).length).toBeGreaterThan(0)
    // Recent log row renders its title.
    expect(screen.getByText('Worktree cleanup completed')).toBeInTheDocument()
  })

  it('renders explicit unavailable shapes when worktrees are disabled and audit log is unreachable', async () => {
    const report: OpsHealthReport = {
      ...healthyReport,
      status: 'degraded',
      worktrees: {
        enabled: false,
        basePath: null,
        totalBytes: null,
        measurable: false,
        directoryCount: 0,
        entries: [],
        error: 'Worktree isolation is disabled in Factory Runtime Settings.',
      },
      logs: { available: false, reason: 'Audit log unavailable: query failed' },
    }
    fetchHelper = mockFetch({ '/api/factory/ops-health': report })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })

    await waitFor(() => {
      expect(screen.getByText(/Worktree isolation is disabled/)).toBeInTheDocument()
    })
    expect(screen.getByText('Audit log unavailable: query failed')).toBeInTheDocument()
    // Never a blank card or ambiguous placeholder.
    expect(screen.queryByText('No worktree directories exist under the configured base path yet.')).not.toBeInTheDocument()
  })

  it('renders an explicit error state when the health request fails', async () => {
    fetchHelper = mockFetch({
      '/api/factory/ops-health': { __status: 500, body: { error: 'health exploded' } },
    })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Ops Health unavailable')
    expect(screen.getByText(/health exploded/)).toBeInTheDocument()
    expect(screen.queryByText('Process & dispatcher')).not.toBeInTheDocument()
  })

  it('refuses to dispatch cleanup until the operator confirms, then posts the confirmation and renders the success result', async () => {
    fetchHelper = mockFetch({
      '/api/factory/ops-health': healthyReport,
      'POST /api/factory/ops-health/cleanup-worktrees': ({ init }: { url: string; init?: RequestInit }) => {
        const body = JSON.parse(String(init?.body ?? '{}'))
        if (body.confirm !== true) {
          return { __status: 400, body: { error: 'Worktree cleanup requires explicit confirmation.' } }
        }
        return { outcome: 'success', removed: 3, reason: null }
      },
    })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })

    const button = await screen.findByTestId('cleanup-confirm-button')
    // Button is disabled until the checkbox is ticked.
    expect(button).toBeDisabled()
    // The page has only fetched the GET — never a POST — before the operator confirms.
    const postCallsBefore = callsOf(fetchHelper!, 'POST', '/ops-health/cleanup-worktrees')
    expect(postCallsBefore.length).toBe(0)

    const checkbox = await screen.findByTestId('cleanup-confirm-checkbox')
    fireEvent.click(checkbox)
    expect(button).not.toBeDisabled()

    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByTestId('cleanup-result')).toBeInTheDocument()
    })
    const result = screen.getByTestId('cleanup-result')
    expect(result.textContent ?? '').toMatch(/Removed 3 inactive worktree/i)
    // Confirm the body sent the explicit confirmation flag.
    const calls = callsOf(fetchHelper!, 'POST', '/ops-health/cleanup-worktrees')
    expect(calls.length).toBe(1)
    expect(requestBody(calls[0]!)).toEqual({ confirm: true })
  })

  it('renders an unavailable outcome when the cleanup primitive is not loaded', async () => {
    fetchHelper = mockFetch({
      '/api/factory/ops-health': healthyReport,
      'POST /api/factory/ops-health/cleanup-worktrees': {
        outcome: 'unavailable',
        removed: 0,
        reason: 'Cleanup primitive is not loaded (dispatcher support unavailable).',
      },
    })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })
    const checkbox = await screen.findByTestId('cleanup-confirm-checkbox')
    fireEvent.click(checkbox)
    fireEvent.click(await screen.findByTestId('cleanup-confirm-button'))

    await waitFor(() => {
      expect(screen.getByText(/Cleanup primitive is not loaded/)).toBeInTheDocument()
    })
  })

  it('renders an error outcome when the cleanup primitive throws', async () => {
    fetchHelper = mockFetch({
      '/api/factory/ops-health': healthyReport,
      'POST /api/factory/ops-health/cleanup-worktrees': {
        outcome: 'error',
        removed: 0,
        reason: 'Permission denied',
      },
    })

    renderWithProviders(<OpsHealth />, { route: '/ops-health' })
    fireEvent.click(await screen.findByTestId('cleanup-confirm-checkbox'))
    fireEvent.click(await screen.findByTestId('cleanup-confirm-button'))

    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeInTheDocument()
    })
  })
})

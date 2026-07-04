import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Repair } from '@/pages/Repair'
import { mockFetch, renderWithProviders } from './test-utils'

let fetchHelper: ReturnType<typeof mockFetch> | undefined

afterEach(() => {
  fetchHelper?.restore()
  fetchHelper = undefined
})

function mockRepair(items: unknown[]) {
  return mockFetch({
    '/api/repair': repairReport(items),
    '/api/projects': [{ id: 'project-1', name: 'ductum' }],
  })
}

function repairReport(items: unknown[]) {
  return {
    generatedAt: '2026-07-01T09:00:00.000Z',
    items,
    groups: [{
      area: 'attempt_recovery',
      label: 'Attempt recovery',
      blocks: 'Attempts that stopped or recorded inconsistent execution.',
      items,
    }],
    summary: {
      total: items.length,
      blockers: 0,
      attention: items.length,
      byArea: {
        factory_setup: 0,
        project_readiness: 0,
        repository_readiness: 0,
        agent_readiness: 0,
        provider_auth: 0,
        workflow_validity: 0,
        spec_start: 0,
        attempt_recovery: items.length,
        migration: 0,
      },
    },
    projectDispatch: [],
  }
}

function item(overrides: Record<string, unknown>) {
  return {
    id: 'attempt:run_1:dirty-worktree',
    area: 'attempt_recovery',
    severity: 'attention',
    title: 'Attempt worktree needs cleanup',
    reason: 'A preserved attempt worktree can be cleaned after a trusted outcome exists.',
    suggestedAction: 'ductum attempt cleanup run_1 --worktree',
    record: { type: 'Attempt', id: 'run_1', name: 'run_1' },
    field: { path: 'attempts.run_1.worktreePaths', label: 'worktree paths', value: '/tmp/worktree' },
    blocks: 'Attempts that stopped or recorded inconsistent execution.',
    status: 'unknown',
    issueCode: 'dirty_attempt_worktree',
    target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_1' },
    href: '/ductum/issue-214/P1/run_1',
    linkLabel: 'Open attempt',
    ...overrides,
  }
}

describe('Repair grouping', () => {
  it('groups duplicate reasons while preserving affected record links', async () => {
    fetchHelper = mockRepair([
      item({ id: 'attempt:run_1:dirty-worktree', record: { type: 'Attempt', id: 'run_1', name: 'run_1' } }),
      item({
        id: 'attempt:run_2:dirty-worktree',
        record: { type: 'Attempt', id: 'run_2', name: 'run_2' },
        target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_2' },
        href: '/ductum/issue-214/P1/run_2',
      }),
    ])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Attempt worktree needs cleanup')).toBeInTheDocument()
    })
    expect(screen.getAllByText('A preserved attempt worktree can be cleaned after a trusted outcome exists.')).toHaveLength(1)
    expect(screen.getByText('2 affected records')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Open attempt/i })).toHaveLength(2)
  })

  it('renders ductum recovery commands as copyable code blocks', async () => {
    fetchHelper = mockRepair([item({})])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('ductum attempt cleanup run_1 --worktree')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Copy recovery command' })).toBeInTheDocument()
  })

  it('suppresses unresolved placeholder commands', async () => {
    fetchHelper = mockRepair([item({ suggestedAction: 'ductum retry <placeholder>' })])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Action needs a concrete record value before it can be copied.')).toBeInTheDocument()
    })
    expect(document.body).not.toHaveTextContent('<placeholder>')
    expect(screen.queryByRole('button', { name: 'Copy recovery command' })).not.toBeInTheDocument()
  })

  it('clusters per-record recovery commands under one root cause', async () => {
    // Realistic case: the API emits one suggestedAction per affected attempt
    // (each command embeds the run id). The dashboard must still cluster them
    // as one root cause, while exposing each per-record command + link.
    fetchHelper = mockRepair([
      item({
        id: 'attempt:run_1:dirty-worktree',
        suggestedAction: 'ductum attempt cleanup run_1 --worktree',
        record: { type: 'Attempt', id: 'run_1', name: 'run_1' },
      }),
      item({
        id: 'attempt:run_2:dirty-worktree',
        suggestedAction: 'ductum attempt cleanup run_2 --worktree',
        record: { type: 'Attempt', id: 'run_2', name: 'run_2' },
        target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_2' },
        href: '/ductum/issue-214/P1/run_2',
      }),
      item({
        id: 'attempt:run_3:dirty-worktree',
        suggestedAction: 'ductum attempt cleanup run_3 --worktree',
        record: { type: 'Attempt', id: 'run_3', name: 'run_3' },
        target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_3' },
        href: '/ductum/issue-214/P1/run_3',
      }),
    ])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getByText('Attempt worktree needs cleanup')).toBeInTheDocument()
    })
    // One cluster, not three top-level cards.
    expect(screen.getAllByText('A preserved attempt worktree can be cleaned after a trusted outcome exists.')).toHaveLength(1)
    expect(screen.getByText('3 affected records')).toBeInTheDocument()
    // Each per-record command is rendered verbatim and copyable.
    expect(screen.getByText('ductum attempt cleanup run_1 --worktree')).toBeInTheDocument()
    expect(screen.getByText('ductum attempt cleanup run_2 --worktree')).toBeInTheDocument()
    expect(screen.getByText('ductum attempt cleanup run_3 --worktree')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Copy recovery command' })).toHaveLength(3)
    // Each affected record keeps its direct navigation link.
    expect(screen.getAllByRole('link', { name: /Open attempt/i })).toHaveLength(3)
  })

  it('clusters by stable issue code even when titles vary in surface form', async () => {
    // Defensively: if two items share the same root cause (issueCode + reason)
    // but the API emits slightly different titles, they should still cluster
    // by issue code. The cluster title is the first item's title.
    fetchHelper = mockRepair([
      item({
        id: 'attempt:run_1:dirty-worktree',
        title: 'Attempt worktree needs cleanup',
        suggestedAction: 'ductum attempt cleanup run_1 --worktree',
        record: { type: 'Attempt', id: 'run_1', name: 'run_1' },
      }),
      item({
        id: 'attempt:run_2:dirty-worktree',
        title: 'Attempt worktree requires cleanup', // surface variation
        suggestedAction: 'ductum attempt cleanup run_2 --worktree',
        record: { type: 'Attempt', id: 'run_2', name: 'run_2' },
        target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_2' },
        href: '/ductum/issue-214/P1/run_2',
      }),
    ])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      // Both items share issueCode + reason, so they collapse into one cluster
      // even though their titles differ slightly. The reason text appears once.
      expect(screen.getAllByText(/A preserved attempt worktree/)).toHaveLength(1)
    })
    // Both per-record commands render inside that one cluster.
    expect(screen.getByText('ductum attempt cleanup run_1 --worktree')).toBeInTheDocument()
    expect(screen.getByText('ductum attempt cleanup run_2 --worktree')).toBeInTheDocument()
  })

  it('keeps blocker and attention severities in separate clusters', async () => {
    // Same root cause, different severity → two clusters (blocker first).
    fetchHelper = mockRepair([
      item({
        id: 'attempt:run_1:dirty-worktree',
        severity: 'blocker',
        suggestedAction: 'ductum attempt cleanup run_1 --worktree',
        record: { type: 'Attempt', id: 'run_1', name: 'run_1' },
      }),
      item({
        id: 'attempt:run_2:dirty-worktree',
        severity: 'attention',
        suggestedAction: 'ductum attempt cleanup run_2 --worktree',
        record: { type: 'Attempt', id: 'run_2', name: 'run_2' },
        target: { projectName: 'ductum', specName: 'issue-214', taskName: 'P1', attemptId: 'run_2' },
        href: '/ductum/issue-214/P1/run_2',
      }),
    ])

    renderWithProviders(<Repair />, { route: '/repair' })

    await waitFor(() => {
      expect(screen.getAllByText('Attempt worktree needs cleanup')).toHaveLength(2)
    })
    // Each cluster exposes its own severity tag and its own per-record command.
    expect(screen.getByText('ductum attempt cleanup run_1 --worktree')).toBeInTheDocument()
    expect(screen.getByText('ductum attempt cleanup run_2 --worktree')).toBeInTheDocument()
  })
})

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
})

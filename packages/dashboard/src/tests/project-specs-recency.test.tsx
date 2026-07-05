import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Spec } from '@/api/client'
import { ProjectSpecsSection } from '@/components/project/ProjectSpecsSection'
import { renderWithProviders } from './test-utils'

const now = '2026-06-15T12:00:00.000Z'

function spec(index: number, overrides: Partial<Spec> = {}): Spec {
  const padded = String(index).padStart(2, '0')
  return {
    id: `spec-${padded}`,
    projectId: 'project1',
    name: `spec-${padded}`,
    status: 'approved',
    document: `Objective: Build the operator workflow for spec ${padded}.`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function renderSpecs(specs: Spec[]) {
  return renderWithProviders(
    <ProjectSpecsSection
      projectName="ductum"
      specs={specs}
      tasks={[]}
      runs={[]}
      agents={[]}
      repositories={[]}
    />,
  )
}

function orderOf(container: HTMLElement, names: string[]): number[] {
  const text = container.textContent ?? ''
  const indices = names.map((name) => text.indexOf(name))
  for (const index of indices) expect(index).toBeGreaterThanOrEqual(0)
  return [...indices].sort((a, b) => a - b).map((index) => indices.indexOf(index))
}

describe('ProjectSpecsSection recency sort', () => {
  it('prefers updatedAt over createdAt for newest-first recency', () => {
    // spec-01 was imported first (older createdAt) but touched most recently
    // (newest updatedAt). spec-02 was imported later but never updated.
    // spec-03 sits in the middle on both timestamps.
    const specs = [
      spec(1, {
        name: 'alpha-old-import',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
      }),
      spec(2, {
        name: 'zeta-recent-import',
        createdAt: '2026-06-15T00:00:00.000Z',
        updatedAt: '2026-06-15T00:00:00.000Z',
      }),
      spec(3, {
        name: 'middle-activity',
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      }),
    ]
    const { container } = renderSpecs(specs)

    // Newest first sorts by updatedAt: alpha (06-20) → zeta (06-15) → middle (06-10).
    expect(orderOf(container, ['alpha-old-import', 'zeta-recent-import', 'middle-activity'])).toEqual([0, 1, 2])

    fireEvent.change(screen.getByLabelText('Sort specs'), { target: { value: 'date_asc' } })
    // Oldest first inverts the updatedAt order: middle (06-10) → zeta (06-15) → alpha (06-20).
    expect(orderOf(container, ['middle-activity', 'zeta-recent-import', 'alpha-old-import'])).toEqual([0, 1, 2])
  })

  it('falls back to a deterministic name tiebreaker when recency is identical', () => {
    const specs = [
      spec(1, { name: 'zeta', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-15T00:00:00.000Z' }),
      spec(2, { name: 'alpha', createdAt: '2026-06-03T00:00:00.000Z', updatedAt: '2026-06-15T00:00:00.000Z' }),
      spec(3, { name: 'middle', createdAt: '2026-06-02T00:00:00.000Z', updatedAt: '2026-06-15T00:00:00.000Z' }),
    ]
    const { container } = renderSpecs(specs)

    // Same updatedAt for all three: tiebreaker must keep the order deterministic
    // and match the visible name sort (alpha → middle → zeta) regardless of
    // date direction.
    expect(orderOf(container, ['alpha', 'middle', 'zeta'])).toEqual([0, 1, 2])

    fireEvent.change(screen.getByLabelText('Sort specs'), { target: { value: 'date_asc' } })
    expect(orderOf(container, ['alpha', 'middle', 'zeta'])).toEqual([0, 1, 2])
  })

  it('falls back to createdAt when updatedAt is missing or unparsable', () => {
    const specs = [
      spec(1, {
        name: 'alpha-invalid-updated',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: 'not-a-date',
      }),
      spec(2, {
        name: 'zeta-valid-updated',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-10T00:00:00.000Z',
      }),
    ]
    const { container } = renderSpecs(specs)

    // zeta has a valid updatedAt (06-10) which beats alpha's invalid updatedAt
    // falling back to createdAt (06-01). Newest first: zeta → alpha.
    expect(orderOf(container, ['zeta-valid-updated', 'alpha-invalid-updated'])).toEqual([0, 1])
  })
})

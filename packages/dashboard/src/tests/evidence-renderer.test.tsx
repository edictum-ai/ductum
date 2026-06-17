import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TypedEvidenceRenderer } from '@/components/evidence/TypedEvidenceRenderer'

describe('TypedEvidenceRenderer', () => {
  it('renders worktree snapshot evidence from the typed registry', () => {
    render(
      <TypedEvidenceRenderer
        type="custom"
        payload={{
          kind: 'worktree.snapshot',
          branch: 'feature/test',
          commitSha: 'abcdef1234567890',
          diffStat: { filesChanged: 2, insertions: 7, deletions: 1 },
          verifyOutput: { command: 'pnpm test', exitCode: 0, tail: 'all tests passed' },
          timestamp: '2026-05-03T12:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('worktree.snapshot')).toBeInTheDocument()
    expect(screen.getByText('feature/test')).toBeInTheDocument()
    expect(screen.getByText('abcdef123456')).toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()
    expect(screen.getByText('+7')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.getByText('verify PASS')).toBeInTheDocument()
    expect(screen.getByText('pnpm test')).toBeInTheDocument()
    expect(screen.getByText('all tests passed')).toBeInTheDocument()
  })

  it('renders operator cancel evidence from the typed registry', () => {
    render(
      <TypedEvidenceRenderer
        type="custom"
        payload={{
          kind: 'operator.cancel',
          reason: 'operator stopped duplicate work',
          worktreePreserved: false,
          cleanupAt: '2026-05-03T12:00:00.000Z',
          timestamp: '2026-05-03T12:00:00.000Z',
        }}
      />,
    )

    expect(screen.getByText('operator.cancel')).toBeInTheDocument()
    expect(screen.getByText('worktree removed')).toBeInTheDocument()
    expect(screen.getByText('operator stopped duplicate work')).toBeInTheDocument()
    expect(screen.getByText('cleanupAt 2026-05-03T12:00:00.000Z')).toBeInTheDocument()
  })
})

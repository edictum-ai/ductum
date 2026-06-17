import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { RunDiff } from '@/api/client'
import { DiffViewer, splitDiffByFile } from '@/components/DiffViewer'

const SAMPLE_DIFF = `diff --git a/packages/core/src/foo.ts b/packages/core/src/foo.ts
index 1234..5678 100644
--- a/packages/core/src/foo.ts
+++ b/packages/core/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
-  return 1
+  return 2
+  // fixed
 }
diff --git a/packages/core/src/bar.ts b/packages/core/src/bar.ts
new file mode 100644
index 0000..abcd
--- /dev/null
+++ b/packages/core/src/bar.ts
@@ -0,0 +1,2 @@
+export const bar = 42
+
`

describe('splitDiffByFile', () => {
  it('groups diff lines into a map keyed by the post-image path', () => {
    const map = splitDiffByFile(SAMPLE_DIFF)
    expect([...map.keys()]).toEqual(['packages/core/src/foo.ts', 'packages/core/src/bar.ts'])
    expect(map.get('packages/core/src/foo.ts')).toContain('+  return 2')
    expect(map.get('packages/core/src/bar.ts')).toContain('+export const bar = 42')
  })

  it('returns an empty map for an empty diff', () => {
    expect(splitDiffByFile('').size).toBe(0)
  })

  it('ignores the (failed) fallback message', () => {
    expect(splitDiffByFile('(failed to collect diff text: nope)').size).toBe(0)
  })
})

describe('DiffViewer', () => {
  function withQueryClient(ui: React.ReactElement) {
    return ui
  }

  it('renders a loading skeleton while diffLoading is true', () => {
    render(withQueryClient(<DiffViewer diff={undefined} isLoading error={undefined} />))
    // The component shows a shimmer div — we check it rendered something.
    expect(document.querySelector('.shimmer')).not.toBeNull()
  })

  it('shows a friendly message when there is no diff', () => {
    const empty: RunDiff = {
      diff: '',
      files: [],
      totals: { files: 0, insertions: 0, deletions: 0 },
      base: 'main',
      truncated: false,
    }
    render(withQueryClient(<DiffViewer diff={empty} isLoading={false} error={undefined} />))
    expect(screen.getByText(/No changes detected/i)).toBeDefined()
  })

  it('renders file list + stats for a populated diff', () => {
    const diff: RunDiff = {
      diff: SAMPLE_DIFF,
      files: [
        { path: 'packages/core/src/foo.ts', insertions: 2, deletions: 1, status: 'text' },
        { path: 'packages/core/src/bar.ts', insertions: 2, deletions: 0, status: 'text' },
      ],
      totals: { files: 2, insertions: 4, deletions: 1 },
      base: 'main',
      truncated: false,
    }
    render(withQueryClient(<DiffViewer diff={diff} isLoading={false} error={undefined} />))
    expect(screen.getByText(/Diff vs main/)).toBeDefined()
    expect(screen.getByText('2 files')).toBeDefined()
    // Both the header and per-file rows contain +4/-1 numbers — use getAll.
    expect(screen.getAllByText('+4').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/-1/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('packages/core/src/foo.ts')).toBeDefined()
  })

  it('handles binary files without crashing', () => {
    const diff: RunDiff = {
      diff: '',
      files: [
        { path: 'assets/logo.png', insertions: 0, deletions: 0, status: 'binary' },
      ],
      totals: { files: 1, insertions: 0, deletions: 0 },
      base: 'main',
      truncated: false,
    }
    render(withQueryClient(<DiffViewer diff={diff} isLoading={false} error={undefined} />))
    expect(screen.getByText('assets/logo.png')).toBeDefined()
  })

  it('shows a friendly error banner when error is set', () => {
    render(withQueryClient(<DiffViewer diff={undefined} isLoading={false} error={new Error('no worktree')} />))
    expect(screen.getByText(/Could not load diff/i)).toBeDefined()
    expect(screen.getByText(/no worktree/)).toBeDefined()
  })
})

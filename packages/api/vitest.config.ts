import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@ductum/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    // Some of the mergeApprovedRun tests shell out to real git
    // (init → commit → merge → push) in a freshly-initialized temp
    // repo. On a hot disk (say, a live `pnpm -r test` running in a
    // sibling worktree alongside the factory's own session-end
    // verify) the 5s default is too tight and they time out. The
    // previous 15s ceiling was right at the edge of the merge-basic
    // and merge-lineage tests' real elapsed time (14–15s under load),
    // so they would flake. Bumped to 30s to absorb that variance —
    // individual fast tests are unaffected, and the slow ones still
    // cap at a reasonable ceiling.
    testTimeout: 30_000,
  },
})

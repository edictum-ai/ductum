import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Several core tests shell out to real git (init → commit → rebase
    // → auto-commit) in freshly-initialised temp repos.  Under the full
    // `pnpm -r test` run, macOS I/O contention pushes these past the
    // 5 s default.  30 s is still tight enough to catch genuine hangs
    // while giving git operations headroom on a loaded machine.
    testTimeout: 30_000,
    // beforeEach hooks in git-heavy tests also need headroom.
    hookTimeout: 30_000,
  },
})

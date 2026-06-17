---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena)
related: 109, 130, 131, 132
---

# Decision 147: Ductum installs globally, not project-local

## Context

The bootstrap-redesign arc (`specs/current/bootstrap-redesign/`)
turns Ductum from "clone the repo" into "install the tool." Two
shapes are possible:

- **Global**: `pnpm install -g ductum` once, then `ductum init` in
  any directory creates a factory there. One CLI binary, many
  factories.
- **Project-local**: each factory directory does
  `pnpm install ductum` and runs the local `node_modules/.bin/ductum`.
  N copies of the CLI; no global binary.

This decision picks one before P0 dispatches.

## Decision

**Global install.** The arc publishes `ductum` as a global npm
package. P4 ships `pnpm install -g ductum`; `ductum init` walks the
new factory creation; `ductum start` boots the bundled API +
dashboard from the install location.

## Why

- Matches the operator's existing reach for tools of this shape:
  `gh`, `vercel`, `stripe`, `supabase`, `pi`, `codex`. The factory's
  primary user is an engineer who reaches for these every day.
  Project-local install would be the surprising shape, not the
  expected one.
- One CLI binary, many factories scales correctly with the operator's
  "one tool, many projects" mental model. Project-local would
  require either juggling `pnpm dlx`/`npx` or maintaining a
  `node_modules/` per factory just to access the tool that
  *manages* the factory.
- Global install also unblocks the recovery exit demo (P5): the
  demo redefines "fresh clone → merged commit < 10 min" as
  "fresh machine, no repo, no env vars." That redefinition only
  makes sense if there's a non-clone install path.

## How to apply

- P0 (`ductum init`) creates `~/ductum/<projectName>/` by default.
  Operator can override via `--dir`.
- P4 (`pnpm publish`) publishes to npm with `bin.ductum` declared.
- The published tarball bundles the API + dashboard so a global
  install needs zero workspace context.
- The repo's existing `pnpm` workspace stays as the *development*
  shape. Global install is the *user* shape. They are not the same
  surface.

## Non-goals

- Not picking a programming-language alternative install (homebrew
  formula, scoop, apt). Future arcs may add those; for now
  `pnpm install -g ductum` (or `npm install -g`) is the sole path.
- Not auto-updating the global binary. `ductum doctor` may surface
  "newer version available," but actual update is operator-initiated
  via `pnpm install -g ductum@latest`. Self-update has its own
  security profile and is out of arc.

## Slop review

- Attack any P-file commit that ships project-local install as the
  primary path. Project-local can be a footnote ("for contributors
  developing Ductum itself, see the legacy `scripts/bootstrap.mjs`
  flow"), not the documented operator path.
- Attack any flow that requires the user to know about the monorepo
  workspace.

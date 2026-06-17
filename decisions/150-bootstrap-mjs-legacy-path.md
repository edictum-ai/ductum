---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena)
related: 109, 130, 131, 132, 147
---

# Decision 150: `scripts/bootstrap.mjs` retained as legacy developer path

## Context

The bootstrap-redesign arc replaces `pnpm bootstrap` (which ran
`scripts/bootstrap.mjs` from inside the cloned repo) with `ductum
init` (which runs from a globally-installed binary, anywhere). Two
shapes for the transition:

- **Delete** `scripts/bootstrap.mjs` once `ductum init` ships.
- **Keep** `scripts/bootstrap.mjs` as the path for "developers
  working *on* Ductum itself," and document the deprecation for
  end users.

D131 + D132 already shipped `scripts/bootstrap.mjs` and
`scripts/bootstrap-support.mjs` with multi-provider auth detection.
The recovery proved that flow works on subscription auth.

## Decision

**Keep** `scripts/bootstrap.mjs` and `scripts/bootstrap-support.mjs`
unchanged through the bootstrap-redesign arc. Mark them as the
legacy "developing Ductum itself" path. End-user docs point at
`ductum init`. Contributor docs (this `CLAUDE.md`, `AGENTS.md`,
`README.md` contributor section) point at `pnpm bootstrap`.

The bootstrap-redesign arc does **not modify** `scripts/bootstrap.mjs`.

## Why

- **Two audiences, two paths.** End users want a global install with
  no clone. Contributors *cloning the repo to develop Ductum itself*
  want a flow that works inside the workspace without first
  publishing and installing a global. These are genuinely different
  shapes; collapsing them into one helps neither audience.
- **D132 just shipped.** The current `bootstrap.mjs` works. Deleting
  it would burn working code for a marginal cleanup gain. The cost of
  keeping it is a single doc-deprecation note.
- **Risk-isolation.** If `ductum init` (P0-P3) hits an unexpected
  bug post-publish (P4), contributors still have a known-good local
  flow to keep developing. Without a fallback, a regression in
  `init` blocks all contributor onboarding.
- **No drift.** `bootstrap.mjs` and `init` share the same
  `resolveProviders()` shape via `scripts/bootstrap-support.mjs` (or
  a CLI-side port). Both invoke the same PKCE core (P1 extracts
  D132's flow into a shared module). They don't diverge — they're
  two entry points into the same auth machinery.

## How to apply

- This arc does not touch `scripts/bootstrap.mjs` or
  `scripts/bootstrap-support.mjs` source. No edits, no renames, no
  deprecation banners injected at runtime.
- `README.md` end-user section gets a single-paragraph "install
  globally with `pnpm install -g ductum`" pointer; the
  contributor/development section keeps `pnpm bootstrap`.
- A future arc may revisit deletion if `bootstrap.mjs` and `init`
  meaningfully diverge or if contributor onboarding consolidates
  around the global install too. Not this arc.

## Non-goals

- Not formally deprecating with a runtime warning printed by
  `scripts/bootstrap.mjs`. The script's audience (people developing
  Ductum) does not need an in-script warning.
- Not testing `bootstrap.mjs` against the new `ductum init` to
  ensure parity. They're different shapes; identical-output tests
  would be the wrong contract.
- Not migrating `bootstrap.mjs`'s tests. They stay green as-is.

## Slop review

- Attack any P0-P5 commit that modifies `scripts/bootstrap.mjs` or
  `scripts/bootstrap-support.mjs`. The arc's scope explicitly
  excludes these files.
- Attack any commit that deletes `scripts/bootstrap.mjs` without a
  follow-up decision recording the deletion.
- Attack any README change that points end users at `pnpm bootstrap`
  after this arc ships. End-user path is `ductum init` only.
- Attack any contributor-doc change that removes the `pnpm bootstrap`
  reference. Contributors keep that path.

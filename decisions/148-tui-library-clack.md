---
date: 2026-05-03
status: accepted
deciders: operator (Arnold Cartagena)
related: 52, 147, 151
---

# Decision 148: `@clack/prompts` as the TUI library for `ductum init`

## Context

The bootstrap-redesign arc adds an interactive TUI to `ductum init`.
Three candidates considered:

| Library | Modern? | Native deps? | Maintenance | License |
|---------|---------|--------------|-------------|---------|
| `inquirer` | aging API | none | active but legacy | MIT |
| `enquirer` | flexible | none | low recent activity | MIT |
| `@clack/prompts` | modern, opinionated | none | active (1.3.0 published 2026-04-29) | MIT |

`prompts` (the lowercase original) was a fourth candidate but its
upstream has been quiet for over a year; `@clack/prompts` is the
spiritual successor with actively maintained primitives.

## Decision

Adopt `@clack/prompts` as the sole TUI prompt library for
`ductum init` and any other future Ductum-CLI human-first surface.

## Why

- **No native deps.** Pure JS. Survives `pnpm` install scripts being
  disabled (per repo `SECURITY.md` policy). `inquirer` and
  `enquirer` also satisfy this; clack does not lose here.
- **Modern primitives.** `intro`, `outro`, `text`, `select`,
  `multiselect`, `confirm`, `spinner`, `note`, `cancel`. Maps
  one-to-one onto the steps `ductum init` walks.
- **Cancel/SIGINT semantics.** `@clack/prompts` exposes `isCancel(value)`
  as a first-class signal. The arc's D135 §8 contract requires clean
  SIGINT handling on every TUI step; clack makes this explicit and
  testable rather than catching exceptions.
- **Small dep tree.** 4 transitive deps (`@clack/core`, `sisteransi`,
  `fast-string-width`, `fast-wrap-ansi`). All well-known, all MIT.
  Audited in D151.
- **Active maintenance.** 1.0.0 → 1.3.0 across Jan-Apr 2026, regular
  cadence, no abandoned-package smell.

## Why not the others

- **inquirer**: API still works but feels dated. The class-based +
  promise style doesn't compose as cleanly with the `init` step
  pipeline. No deal-breaker, but clack is a better fit for the
  shape we're building.
- **enquirer**: looked promising on paper; recent npm activity is
  thin and the docs are stale. Higher maintenance risk than clack.
- **prompts** (lowercase): upstream silent for 12+ months. The risk
  of building on a dormant package is exactly what D52 supply-chain
  rules exist to push back against.

## How to apply

- Install `@clack/prompts@1.2.0` exactly. Do **not** use 1.3.0
  yet — it published 2026-04-29 (4 days before this decision)
  and fails the repo's 7-day buffer rule. Re-audit and bump to a
  newer pin once it matures, or pin a later version that has
  passed the buffer at install time.
- All TUI surfaces in this arc go through `@clack/prompts`. Do not
  mix in `inquirer` or `enquirer` for a single prompt — consistency
  matters more than per-prompt optimization.
- Tests assert clack `isCancel` semantics on every prompt step
  (mock the prompt return value, ensure the cancel branch runs the
  rollback path).

## Non-goals

- Not hand-rolling a TUI from `readline`. The arc has enough scope.
- Not vendoring clack source. Use the published package; trust
  the lockfile + audit.

## Slop review

- Attack any commit that adds a competing TUI lib in the same arc.
- Attack any commit that pins `@clack/prompts` at `^1.2.0` or
  `~1.2.0` — exact pins only per D52.
- Attack any commit that ships clack 1.3.0 without the 7-day
  buffer being satisfied at install time.

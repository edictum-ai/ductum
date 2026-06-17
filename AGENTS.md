# AGENTS.md — Ductum

Instructions for Codex (GPT-5.4) when implementing in this repo.

## Your role

You are the primary builder for Ductum.

**ACTIVE MISSION (2026-06-09 onward): Post-P9 hardening after operational model redesign PASS.**
- `specs/current/operational-model-redesign/` is closed after P9 PASS on
  2026-06-09. Closeout: `decisions/166-operational-model-redesign-closeout.md`.
- P1-P9 are done/pass. The accepted normal operator model is Factory ->
  Project -> Repository/Component -> Spec -> Task -> Attempt, with Factory
  Settings owning Providers, Models, Harnesses, Workflows, Agents, sandboxes,
  notifications, budgets, and app settings.
- Current polish backlog: `specs/current/post-p9-hardening/README.md`.
  These are post-P9 hardening items, not blockers to the redesign closeout.
  Ductum may now dogfood later polish stages when a stage prompt says to.
- Bootstrap redesign is not the active mission. It remains paused by D161 until
  a separate audit/resume decision changes that state.
- Every new CLI surface still honors the D135 agent-first contract shipped in
  the operational hardening bundle (D136-D145).
- Drive Ductum via the `ductum-cli` skill for factory operation and
  `ductum-onboard` for adding external repos. No curl, no SQLite, no
  `ductum.yaml`. If you reach for one of those, stop and read the skill.

**Recovery closed (2026-05-02).** `factory-readiness-recovery` shipped
all seven P-stages to main as Outcome A. Closeout decision:
`decisions/131-factory-readiness-recovery-closeout.md`. The exit-demo
wall-clock could not be honestly verified this session because the
bootstrap prereq is too narrow for subscription-auth users — that's
exactly what D130 fixes. Read 131 before doing anything that touches
`scripts/bootstrap*` or the recovery's stage files.

The current product direction is in `specs/CURRENT.md`,
`specs/current/post-p9-hardening/README.md`, and decisions `053` through
`057` plus `166`. Decisions `109`, `131`, and `166` together supersede any
older "next implementation theme" guidance.

The old `specs/impl-*` prompts are historical implementation records and import
fixtures. Do not treat them as the active roadmap unless the user explicitly
asks for that spec.

## How to pick up current work

1. Read `specs/CURRENT.md`.
2. Read `specs/current/post-p9-hardening/README.md` and decision `166`.
3. Read decisions `053` through `057`.
4. Inspect the current code before editing. Import existing modules; do not
   duplicate local patterns.
5. Work in small, verified slices. If a prompt has a verification checklist,
   run every item.
6. If a test fails, fix it before moving on. Do not claim done with failing
   tests.

## External review workflow

When the user asks for a Claude or GLM review, get the review text, not just a
zero exit code or a quiet run. A silent review command that reaches its turn cap
without findings is a failed review attempt.

For deterministic implementation reviews, feed Claude a focused pasted diff
and disable tools so it must return findings:

```sh
(
  printf '%s\n' 'You are reviewing a pasted git diff. Do not use tools. Return findings first.'
  printf '%s\n' 'Return PASS/WARN/FAIL, findings with file refs, verification notes, and dogfood safety.'
  printf '%s\n' '--- DIFF START ---'
  git diff -- path/or/package1 path/or/package2
  git ls-files --others --exclude-standard -- path/or/package1 path/or/package2 |
    while IFS= read -r file; do
      git diff --no-index -- /dev/null "$file" || true
    done
  printf '%s\n' '--- DIFF END ---'
) | claude -p --no-session-persistence --tools "" --permission-mode dontAsk --max-turns 1 --max-budget-usd 5
```

If Claude needs local filesystem tools, set a high enough turn cap and do not
treat the run as complete until it prints findings. If it times out or hits the
turn cap without findings, rerun with a pasted diff and `--tools ""`.

When using a local `glmcode` alias, first ask which model is answering and save
the answer with the review artifacts. Keep review prompts, pasted diffs, and
outputs under `.scratch/<topic>/` when the review is part of implementation
validation.

## Current implementation sequence

Work through post-P9 hardening in order, but only when a stage prompt exists:

1. P0 workflow validity targeting and secret-message wording
2. P1 safety/honesty hardening
3. P2 model/API architecture seams
4. P3 cleanup debt
5. P4 process directives

Do not add top-level `Operation` or `WorkOrder` tables yet. Model multi-repo
work first as fan-out specs and target-scoped tasks.

## Design constraints you found (do not violate)

These came from YOUR adversarial review. You know why they matter.

- **C1:** authorize_tool is harness-internal, gate_check is agent-visible. Two distinct paths.
- **C2:** Enforcement is structural via harness, not advisory via prompts.
- **C3:** authorize_tool is NOT in the MCP surface.
- **C4:** Agents do not self-reset. Ductum Core owns resets.
- **C5:** Session-to-run binding is authoritative. No run_id in prompts.
- **C6:** CI and review are parallel latches, not sequential.
- **C7:** fixing is narrower than implementing.

## Decisions from your review (D22-D27)

| Decision | What it means for implementation |
|----------|--------------------------------|
| D22 | MCP server is per-session, pre-bound to run_id. Tool signatures have NO run_id parameter. |
| D23 | SQLite StorageBackend must implement full interface: getCounter, incrementCounter, getValue, setValue, deleteValue. Two tables. |
| D24 | @edictum/core Session keyed by run.id (stable), never harness sessionId (volatile). |
| D25 | Dispatcher is sole creator of session_run_mapping. Adapters return sessionId, dispatcher records it. |
| D26 | Watchers create child Run records. Evidence deduped by commit SHA. Old watchers stopped on re-push. |
| D27 | One WorkflowRuntime per run (shared definition, per-run instance). Never share runtime across runs. |

## Tech stack

- pnpm workspaces (monorepo)
- TypeScript (strict, ESM, Node 22)
- Vitest for testing
- better-sqlite3 (synchronous, WAL mode)
- Hono (REST API)
- @modelcontextprotocol/sdk (MCP server)
- @edictum/core ^0.3.1 (workflow enforcement)
- React 19 + Vite + Tailwind + shadcn/ui (dashboard)
- nanoid (IDs)
- commander (CLI)

## Related repos to read

- `edictum-ai/edictum-ts` — especially `packages/core/src/workflow/runtime.ts`, `packages/core/src/runner.ts`, `packages/core/src/session.ts`, `packages/core/src/storage.ts`
- `edictum-ai/edictum-harness` — `PROCESS.md`, `specs/m1/impl-017/` (reference for prompt format)

## Rules

- No file over 300 LOC. Split if needed.
- Tests first when the prompt says "write tests first."
- `rules` not `contracts`, `blocked` not `denied`, `pipeline` not `engine`.
- Run `pnpm test` in the package after every prompt. All tests must pass.
- If you hit a gap in the spec, record it as a decision in `decisions/` — don't silently guess.

## How file size is enforced

`scripts/check-file-size.mjs` scans `packages/**/*.{ts,tsx}` and fails when a
non-grandfathered source or test file exceeds 300 LOC. Current exceptions live
in `decisions/112-file-size-grandfather-list.md`; remove entries as splits land.

## Supply chain security (mandatory)

Read `SECURITY.md` for full context on the March 2026 attacks (TeamPCP, axios/UNC1069).

- **Exact pins only.** Never use `^` or `~`. `save-exact=true` is set in `.npmrc`.
- **Always commit `pnpm-lock.yaml`.** Never delete it or gitignore it.
- **Scripts are disabled.** If a dep needs postinstall, add it to `pnpm.onlyBuiltDependencies` in root `package.json` and get approval.
- **No blind upgrades.** Never run `npm update` or `npx npm-check-updates`. Review each update individually.
- **No git/tarball deps** unless explicitly approved.
- **Verify packages** on npmjs.com before adding. Prefer verified publishers with provenance.
- **Use `--frozen-lockfile`** in all CI and scripts.

## Review history

Initial design review: 4 rounds completed. Findings: F1-F7 (round 1),
F8-F11 (round 2), C1-C3 (round 3), F12-F17 (round 4). The newer resource
model decisions start at D53. See `decisions/`.

# D113: P7 file-size discipline shipped

**Date:** 2026-04-30
**Decided by:** Arnold + Codex
**Linked spec:** `specs/current/factory-readiness-recovery/P7-FILE-SIZE-DISCIPLINE.md`
**Ductum task:** `9u86RRmQf9e1` (`P7-FILE-SIZE-DISCIPLINE`)

## Context

P7 turns the repo's existing 300 LOC rule into an executable gate and removes
the highest-risk oversized files by refactor only. P7 was allowed to run in
parallel with P1 as long as it avoided P1-owned CLI command/skill work.

## Decision

P7 is shipped. The file-size gate is in `scripts/check-file-size.mjs`, script
tests cover it, and `pnpm test:scripts` runs the gate. The grandfather list is
`decisions/112-file-size-grandfather-list.md`.

## Commit Trace

| Commit | Message | P7 mapping |
|---|---|---|
| `62eabc2` | `test(scripts): add file-size gate coverage` | Gate script, script tests, `pnpm test:scripts` wiring. |
| `2123454` | `docs(decisions): record file-size grandfather baseline` | Baseline decision with 49 oversized files. |
| `85a8669` | `refactor(core): split post-completion-router into route modules` | P7.3.1 top split. |
| `235385e` | `refactor(core): split dispatcher into lifecycle modules` | P7.3.2 top split. |
| `00d34fd` | `refactor(api): split run-ops into operation modules` | P7.3.3 top split. |
| `98b9b81` | `refactor(dashboard): split RunDetail into focused panels` | P7.3.4 top split. |
| `fb725eb` | `refactor(api): split routes.test into route groups` | P7.3.5 top split. |
| `c5c90cf` | `refactor(core): split dispatcher.test into behavior suites` | P7.3.6 top split. |
| `32981ef` | `refactor(core): split post-completion-router.test into route suites` | P7.3.7 top split. |
| `9827fb5` | `refactor(core): split enforce.test into behavior suites` | P7.4 clear-seam sweep split. |
| `44794aa` | `docs(decisions): record file-size sweep rationales` | Replaced remaining sweep placeholders with one-line rationales. |
| `a61750c` | `docs: document file-size gate` | Added AGENTS/CLAUDE enforcement notes. |
| `d97dfdd` | `test(scripts): demonstrate file-size gate failure` | Intentional 320 LOC demo fixture. |
| `3c9c386` | `Revert "test(scripts): demonstrate file-size gate failure"` | Immediate revert of the intentional failing demo. |
| This commit | `docs(plan): mark P7 file-size discipline shipped` | README checkbox, shipped decision, and Ductum CLI completion evidence. |

## LOC Evidence

| Split | Before | After | Test count |
|---|---:|---:|---|
| `packages/core/src/post-completion-router.ts` | 1,024 | 999 | `@ductum/core`: 466 |
| `packages/core/src/dispatcher.ts` | 1,170 | 1,098 | `@ductum/core`: 466 |
| `packages/api/src/lib/run-ops.ts` | 1,290 | 1,210 | `@ductum/api`: 312 |
| `packages/dashboard/src/pages/RunDetail.tsx` | 1,300 | 1,165 | `@ductum/dashboard`: 139 |
| `packages/api/src/tests/routes.test.ts` | 3,276 | 3,227 | `@ductum/api`: 312 |
| `packages/core/src/tests/dispatcher.test.ts` | 1,634 | 1,556 | `@ductum/core`: 466 |
| `packages/core/src/tests/post-completion-router.test.ts` | 1,058 | 1,055 | `@ductum/core`: 466 |
| `packages/core/src/tests/enforce.test.ts` | 843 | 837 | `@ductum/core`: 466 |

Split LOC total: 11,595 before, 11,147 after. Net reduction: 448 LOC.

Grandfather count: 49 before P7, 42 after the required top-seven splits, 41
after the enforce sweep split.

## Demo Evidence

The deliberate oversized fixture failed the gate before it was reverted:

```text
File-size gate failed: 1 file(s) exceed 300 LOC.
Grandfather list: decisions/112-file-size-grandfather-list.md
- packages/core/src/tests/file-size-demo-fixture.test.ts: 320 LOC (20 over)
Split the file or add a justified entry to the grandfather-list decision.
```

After revert, the gate passed with 41 grandfathered files.

## Verification

Final verification:

```sh
pnpm build
pnpm -r test
pnpm test:scripts
node scripts/check-file-size.mjs
```

Observed test counts:

- `@ductum/core`: 466
- `@ductum/api`: 312
- `@ductum/dashboard`: 139
- `@ductum/cli`: 379
- `@ductum/harness`: 123
- `@ductum/mcp`: 14
- `scripts`: 18

## Task Closeout

The Ductum task was marked done through the CLI:

```sh
node packages/cli/dist/index.js task complete 9u86RRmQf9e1 --reason "P7 file-size discipline shipped"
```

CLI output:

```text
Completed task P7-FILE-SIZE-DISCIPLINE (9u86RRmQf9e1); decision xB7d08TtUZXF.
```

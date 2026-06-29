# D112: File-size grandfather list

**Date:** 2026-04-30
**Decided by:** Arnold + Codex
**Linked spec:** `specs/current/factory-readiness-recovery/P7-FILE-SIZE-DISCIPLINE.md`

## Context

P7 turns the existing "No file over 300 LOC" rule into an enforced gate.
The repository starts with 49 TypeScript/TSX source and test files over
300 LOC, totaling 29,029 LOC across grandfathered files.

`scripts/check-file-size.mjs` reads this decision as the exception list.
Any `packages/**/*.ts` or `packages/**/*.tsx` file over 300 LOC that is
not listed here fails the gate. Remove entries as P7 splits land.

## Grandfathered Files

| LOC | File | P7 tag | Landing rationale |
|---:|---|---|---|
| 837 | `packages/cli/src/tests/spec-import.test.ts` | P7.4 | Deferred while P1 owns CLI import/command behavior; splitting test fixtures now would create conflict-prone churn. |
| 819 | `packages/core/src/db-migrations.ts` | P7.4 | Chronological migration ledger; splitting would make audit order harder to inspect. |
| 636 | `packages/dashboard/src/tests/pages.test.tsx` | P7.4 | Fixture-heavy page smoke suite; splitting needs a shared dashboard test harness pass to avoid duplicating mocks. |
| 633 | `packages/cli/src/tests/commands.test.ts` | P7.4 | Deferred while P1 owns CLI command surfaces; large integration suite is intentionally kept together for command coverage. |
| 632 | `packages/core/src/enforce.ts` | P7.4 | Structural enforcement core; extraction needs a dedicated design pass to keep authorize/gate/reset paths coupled correctly. |
| 565 | `packages/dashboard/src/pages/SpecDetail.tsx` | P7.4 | Page-level component with tightly coupled loaders, actions, and rows; split with a future UI component pass. |
| 525 | `packages/core/src/cost-scanner.ts` | P7.4 | Scanner cache and parser normalization share rate tables; parser extraction should be done as a focused scanner refactor. |
| 523 | `packages/harness/src/copilot-sdk.ts` | P7.4 | Single harness adapter class; splitting private callbacks would obscure session lifecycle flow. |
| 500 | `packages/cli/src/tests/helpers.ts` | P7.4 | Shared CLI fixture catalog; splitting would scatter common mock objects used across command tests. |
| 500 | `packages/api/src/tests/execution-integrity.test.ts` | P7.4 | One policy-focused API suite with shared setup; split later with the execution-integrity test harness. |
| 483 | `packages/core/src/post-completion.ts` | P7.4 | Post-completion helpers share prompt, verify, and verdict contracts; extract only with a prompt/verification module pass. |
| 469 | `packages/core/src/tests/state-machine.test.ts` | P7.4 | Single RunStateMachine fixture covers all transitions; splitting would add harness indirection for one cohesive state suite. |
| 463 | `packages/dashboard/src/components/homepage/SpecGroups.tsx` | P7.4 | Cohesive homepage grouping component; split only alongside homepage component layout work. |
| 456 | `packages/core/src/repos/run.ts` | P7.4 | Run repository and history repository share row mapping and schema assumptions; split with a repository boundary pass. |
| 454 | `packages/api/src/index.ts` | P7.4 | API composition root wires shared server dependencies; splitting routes from startup belongs in a server bootstrap refactor. |
| 431 | `packages/api/src/routes/runs.ts` | P7.4 | Run route module keeps run lifecycle endpoints adjacent; extraction needs route grouping tests to avoid handler drift. |
| 429 | `packages/core/src/tests/repos.test.ts` | P7.4 | Repository integration test uses one DB fixture across CRUD/cascade/session assertions; splitting would duplicate setup. |
| 410 | `packages/harness/src/tests/claude.test.ts` | P7.4 | Claude adapter tests share SDK stream mocks; split with a dedicated harness test-fixture extraction. |
| 403 | `packages/dashboard/src/api/client.ts` | P7.4 | API shape catalog and typed client methods stay together; splitting would add import churn without isolating behavior. |
| 386 | `packages/harness/src/claude.ts` | P7.4 | Single Claude harness adapter; private lifecycle/token helpers are easier to audit inline. |
| 372 | `packages/dashboard/src/components/approval/ApprovalCard.tsx` | P7.4 | Approval card subcomponents share one interaction surface; split with approval UI redesign, not as mechanical churn. |
| 353 | `packages/api/src/tests/run-close-outcome.test.ts` | P7.4 | Outcome tests share close-run fixture state; small excess does not justify another shared helper layer. |
| 347 | `packages/api/src/tests/notification-channel-runtime.test.ts` | P7.4 | Notification channel runtime tests share backend mocks; split later with a notification test harness pass. |
| 341 | `packages/core/src/tests/dag.test.ts` | P7.4 | DAG evaluator suite shares graph fixture helpers; splitting would add ceremony around one algorithm contract. |
| 335 | `packages/cli/src/api-client.ts` | P7.4 | Deferred while P1 owns CLI client paths; avoid rebasing against task-complete command work. |
| 333 | `packages/cli/src/tests/queue-command.shared.ts` | P7.4 | Deferred while P1 owns CLI command behavior; shared queue scenarios are one integration contract. |
| 329 | `packages/core/src/model-pricing.ts` | P7.4 | Pricing constants and compute helpers must stay colocated until live-pricing/cache semantics are split deliberately. |
| 326 | `packages/cli/src/tests/telegram-command.test.ts` | P7.4 | CLI command test; deferred to avoid P1 CLI test churn and Telegram fixture duplication. |
| 326 | `packages/cli/src/commands/factory-ops.ts` | P7.4 | Deferred while P1 owns CLI command paths. |
| 323 | `packages/dashboard/src/components/run/RunLineageTree.tsx` | P7.4 | Lineage tree builder and renderer share node shape; split with future run-tree component pass. |
| 321 | `packages/cli/src/commands/admin.ts` | P7.4 | Deferred while P1 owns CLI command paths. |
| 320 | `packages/cli/src/types.ts` | P7.4 | CLI API type catalog; splitting generated/shared shapes would increase import churn for marginal LOC. |
| 319 | `packages/dashboard/src/components/TaskDAG.tsx` | P7.4 | Graph layout and node rendering share React Flow node types; split with a graph component refactor. |
| 318 | `packages/cli/src/tests/agent-health-command.test.ts` | P7.4 | CLI command test; deferred to avoid P1 CLI test churn and preserve model-catalog fixture locality. |
| 315 | `packages/api/src/lib/operator-brief.ts` | P7.4 | Operator brief builders share one response contract; split only with API DTO boundary work. |
| 303 | `packages/api/src/routes/projects.ts` | P7.4 | Just over limit; project route helpers and handlers are small enough that splitting would add route indirection. |
| 301 | `packages/dashboard/src/components/homepage/RunFeed.tsx` | P7.4 | One line over and cohesive feed component; splitting would create churn for negligible size gain. |
| 301 | `packages/dashboard/src/api/hooks.ts` | P7.4 | One line over; query hook catalog is easier to scan in one file until API hooks are regrouped by domain. |
| 301 | `packages/core/src/tests/sandbox-runtime-driver.test.ts` | P7.4 | One line over; sandbox driver tests share a compact fixture and splitting would add more helper code than it removes. |

## Update Rule

Every P7 split commit removes the split source file from this list when
the original path falls to 300 LOC or less. The sweep pass leaves only
entries with one-line rationales for why splitting would harm readability
or why ownership belongs to a parallel stage.

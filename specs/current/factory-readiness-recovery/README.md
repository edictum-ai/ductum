# Factory Readiness Recovery

Turn Ductum into a factory the operator can trust to run itself, by closing
the gaps the 2026-04-30 audit exposed.

## Decision Trace

- Decision `109`: this spec is the staged recovery plan.
- Decision `052`: Pi remains blocked.
- Decision `053`: factory-resource-model primitives stay as-is.
- Decision `055`: notification channels are pluggable transports.
- Decision `060`: malformed review output is drift, not success.
- Decision `108`: execution integrity must be operator-visible and explicit.

## Behavior Contract

- Stage 0 + 1 ship operator-direct on `main` with conventional commits.
  These are prerequisites for dogfooding the rest.
- Stage 2 onward dispatches through Ductum. Agents must drive Ductum via
  the `ductum-cli` skill, not via curl, not via direct SQLite, not via
  hand-edited yaml.
- Each stage exits on a demo, not on tests-pass. The exit criterion is
  named in each P-file.
- A stage merges in full before the next begins. No interleaving.
- Exception: P7 (file-size discipline) is assigned to codex and may run
  in parallel with P1. P7 only does structural splits — no behavior
  changes — so it does not conflict with the skill work in P1 or any
  in-flight stage. P7 must merge before P3 starts so the dispatcher /
  router splits don't fight in-flight P3 work.

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 0 | [P0-PREREQUISITES.md](P0-PREREQUISITES.md) | dashboard/cli/api | Token UX, spec list status, /runs route, SpecStatus=failed, 3 missing CLIs | [x] (D110) | - |
| 1 | [P1-CLI-SKILL.md](P1-CLI-SKILL.md) | skills | ductum-cli skill + self-test | [x] (D111) | P0 |
| 2 | [P2-DASHBOARD-TRUTHFULNESS.md](P2-DASHBOARD-TRUTHFULNESS.md) | dashboard | Resource pickers, spec import button, dependency picker, harness source-of-truth, decisions split, glm cleanup, home skeleton | [ ] | P0, P1 |
| 3 | [P3-FACTORY-DURABILITY.md](P3-FACTORY-DURABILITY.md) | core/api | Persistent session-binding, approval auto-rebase, reviewer-format compat, spec-budget realism | [ ] | P0, P1 |
| 4 | [P4-CATALOG-TRUTH.md](P4-CATALOG-TRUTH.md) | core/api/dashboard | Claude models/harness as resources, Pi doctor signal, Telegram wizard end-to-end, glm follow-up | [ ] | P2, P3 |
| 5 | [P5-DIARY-CLEANUP.md](P5-DIARY-CLEANUP.md) | core | Bulk-import 30 unimported specs as recorded mode; mark abandoned drafts failed | [ ] | P0 |
| 6 | [P6-BOOTSTRAP-PROOF.md](P6-BOOTSTRAP-PROOF.md) | scripts/cli | pnpm bootstrap fresh-clone-to-merged-commit demo | [ ] | P0-P5 |
| 7 | [P7-FILE-SIZE-DISCIPLINE.md](P7-FILE-SIZE-DISCIPLINE.md) | core/api/dashboard/cli/scripts | Enforce ≤300 LOC: CI gate + grandfather list + split top 7 mega-files. Assigned to **codex**. Runs in parallel with P1. | [x] (D113) | P0 |

## Verification

For each stage, the P-file lists its exit demo. Spec-level verification:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

After Stage 6: a fresh `git clone` + `pnpm bootstrap` reaches one merged
commit and a green factory in under 10 minutes, on a machine where the
operator has only their API keys configured.

## Drift Handling

Cross any non-goal listed in Decision 109? Record a Decision before doing
it. No silent expansion.

## Slop Review

- Attack any stage that ships without its exit demo.
- Attack any commit that bypasses Ductum dispatch in Stage 2+.
- Attack new top-level primitives, new policy paths, or new harnesses
  that aren't already in `harnesses:` after Stage 4.
- Attack Stage 5 imports that mark unimported specs `done` without a
  linked commit and a decision trace.

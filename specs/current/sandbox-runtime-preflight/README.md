# Sandbox Runtime Preflight

## Intake

Make `Agent.resourceRefs.sandboxRef` meaningful at the runtime boundary without
building a real sandbox driver yet.

## Grill Questions

- Where is the boundary? Dispatcher dispatch and API accept both create Run
  records, so both must preflight `sandboxRef` before writing a run.
- Where does audit state live? The existing Run snapshot is enough; adding a
  new table or top-level primitive is not justified.
- Should Ductum enforce sandbox policy? No. Edictum remains the policy engine,
  and sandbox process isolation waits for the separate driver slice.
- Should a harness support matrix block dispatch? No. This slice only proves
  the referenced `SandboxProfile` exists and snapshots it for audit.

## Decision Trace

- Decisions: `053`, `054`, `056`, `057`, `058`, `059`, `060`, `065`, `066`,
  `067`, `068`, `069`, `070`, `071`, `072`, `073`, `074`, `075`, `076`, `077`,
  `078`.
- Non-goals: no real sandbox driver; no fake sandbox runtime branch; no
  provider support matrix enforcement; no Edictum policy change; no second
  policy engine; no Operation or WorkOrder table; no new top-level primitive or
  table; no new dependency.
- Allowed scope: shared sandbox ref resolution, dispatcher preflight,
  API/manual run creation preflight, Run audit snapshot persistence, behavioral
  tests, dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/sandbox-runtime-preflight --path`,
  `ductum spec drift-review ductum sandbox-runtime-preflight`,
  `pnpm --filter @ductum/core test`, `pnpm --filter @ductum/api test`,
  `pnpm --filter @ductum/cli test`, `pnpm build`, `git diff --check`, and
  Claude adversarial slop review.
- Drift handling: record a decision before adding sandbox process isolation,
  provider support enforcement, policy enforcement, new tables, new
  dependencies, or any harness execution behavior change.

## Behavior Contract

- An agent with `resourceRefs.sandboxRef` must resolve that ref before run or
  harness session creation.
- Unknown `sandboxRef` must fail loudly before creating a run or harness
  session.
- Wrong-kind `sandboxRef` must fail loudly before creating a run or harness
  session.
- Cross-project `sandboxRef` must fail loudly before creating a run or harness
  session.
- Malformed `SandboxProfile` resources without provider or mode must fail
  loudly before creating a run or harness session.
- A bad `sandboxRef` must never silently fall back to no sandbox.
- Legacy agents without `sandboxRef` must dispatch exactly as before.
- The resolved sandbox profile must be visible in Run audit state before
  execution begins.
- The Run audit snapshot must not copy credential-shaped `SandboxProfile.spec`
  fields verbatim.
- Errors must be visible in CLI/API/operator output, not only logs.
- Runtime execution must remain unchanged: no sandbox driver, no Edictum policy
  change, no second policy engine, and no new top-level primitive/table.

## Slop Review

- Did the implementation satisfy every Behavior Contract item?
- Are tests behavioral, not just shape checks?
- Are missing/invalid sandbox refs loud failures?
- Did any path silently ignore a bad sandbox ref?
- Did it duplicate config-resource lookup logic?
- Did it add a fake sandbox runtime branch?
- Did it add policy enforcement in Ductum instead of Edictum?
- Did it preserve legacy dispatch behavior when refs are absent?

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-SANDBOX-RUNTIME-PREFLIGHT.md](P1-SANDBOX-RUNTIME-PREFLIGHT.md) | core/api | Sandbox ref preflight, Run audit snapshot, behavioral tests, dogfood | [x] | - |

## Dogfood Record

- Imported as spec `sandbox-runtime-preflight` (`6btRQIkTbVEn`) in project
  `ductum`.
- Task `P1-SANDBOX-RUNTIME-PREFLIGHT` imported as `JpUjRCNMAnIb`, assigned to
  `codex-resource-dogfood`, and accepted as run `_31kykZqkxw6`.
- Recorded decision evidence: `Rk_wqSc5MIWw` for decision `077`.
- Recorded redaction decision: `l8J8i8aYYi2K` for decision `078`.
- Recorded evidence: spec audit `VvcqH86qv__I`.
- Recorded final verification evidence: `9ORscpYidDzU`.
- Recorded final Claude slop review evidence: `p3ewGVwIsBY0` with `PASS`.

## Verification

```sh
ductum spec contract-check ductum specs/current/sandbox-runtime-preflight --path
ductum spec drift-review ductum sandbox-runtime-preflight
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```

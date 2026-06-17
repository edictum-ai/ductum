# P1 - Sandbox Runtime Preflight

## Scope

Resolve `Agent.resourceRefs.sandboxRef` at run/session creation boundaries and
persist the resolved sandbox profile on the Run for audit. Do not build a real
sandbox driver.

## Decision Trace

- Decisions: `053`, `054`, `056`, `057`, `058`, `059`, `060`, `065`, `066`,
  `067`, `068`, `069`, `070`, `071`, `072`, `073`, `074`, `075`, `076`, `077`,
  `078`.
- Non-goals: no real sandbox driver; no fake sandbox runtime branch; no
  provider support matrix enforcement; no Edictum policy change; no second
  policy engine; no Operation or WorkOrder table; no new top-level primitive or
  table; no new dependency.
- Allowed scope: shared resolver extension, dispatcher preflight,
  API/manual-run preflight, Run snapshot persistence, and behavioral tests.
- Verification: contract-check, drift-review, package tests, build,
  `git diff --check`, and adversarial Claude slop review.
- Drift handling: stop and record a decision before adding process isolation,
  enforcing provider support, changing Edictum policy, adding tables, or
  changing harness execution behavior.

## Behavior Contract

- A `sandboxRef` must resolve to a `SandboxProfile` resource before run or
  harness session creation.
- Missing `sandboxRef` targets must fail in CLI/API/operator-visible output
  before run creation.
- Wrong-kind `sandboxRef` targets must fail in CLI/API/operator-visible output
  before run creation.
- Cross-project `sandboxRef` targets must fail in CLI/API/operator-visible
  output before run creation.
- Malformed `SandboxProfile` resources without `spec.provider` or `spec.mode`
  must fail before run creation.
- A provided bad `sandboxRef` must not fall back to a legacy no-sandbox run.
- Agents without `sandboxRef` must preserve legacy dispatch behavior.
- Successful preflight must be visible by persisting the resolved sandbox
  profile on the Run before harness spawn.
- Run snapshots must not persist credential-shaped `SandboxProfile.spec` fields
  into run audit state.
- API accept/manual run creation must not duplicate sandbox resolver lookup
  logic.
- Runtime execution must remain unchanged: no sandbox driver, fake driver
  branch, second policy engine, Edictum policy change, new top-level
  primitive/table, or dependency.

## Implementation Notes

- Extend the existing core Agent runtime ref resolver instead of adding another
  config-resource lookup path.
- Keep `modelRef` and `harnessRef` behavior unchanged except for sharing the
  resolver shape with `sandboxRef`.
- Store a compact Run snapshot with sandbox id, name, project scope, provider,
  mode, and redacted non-credential spec JSON.
- Dispatcher must resolve the sandbox before `runRepo.create` and before MCP or
  harness session creation.
- API accept/manual run creation must resolve the sandbox before `runRepo.create`.
- Do not validate provider availability or harness `supportedSandboxes` in this
  slice.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are bad sandbox refs loud and pre-run?
- Did a wrong-kind or cross-project sandbox ref ever use a no-sandbox fallback?
- Did this duplicate resolver logic in CLI, API, or dispatcher?
- Did this add dead sandbox runtime branches?
- Did legacy no-ref dispatch still run?

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

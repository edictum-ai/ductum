# Sandbox Settings Runtime Alignment

## Intake

The runtime now supports one real sandbox driver: `host/worktree`. Settings
still generates `local/permissive` SandboxProfile resources, and settings/API
validation accepts an Agent `sandboxRef` to that unsupported runtime shape.

This slice aligns settings and API validation with the runtime so bad referenced
sandbox profiles fail before save or Agent write, not later at dispatch.

## Grill Questions

- Should unreferenced future SandboxProfile shells be rejected? No. Only
  referenced sandbox profiles are runtime commitments in this slice.
- Should this add a Docker or remote sandbox driver? No. The only supported
  runtime remains `host/worktree`.
- Should dashboard enforce policy? No. Edictum remains the policy system.
- Should the UI claim network or credential isolation? No. It only creates the
  supported host/worktree profile and leaves advanced fields in YAML.

## Decisions

- Add decision `102` for sandbox settings/runtime alignment.
- Reuse the core sandbox runtime validator in API Agent/settings validation.
- Change Settings "Add sandbox" defaults to `provider: host`, `mode: worktree`.
- Preserve legacy/no-ref behavior and unreferenced SandboxProfile config shells.
- Preserve `process` claims in config resources so referenced unsupported claims
  fail visibly instead of being normalized away.

## Decision Trace

- Decisions: `053`, `056`, `057`, `058`, `059`, `060`, `064`, `066`, `077`,
  `078`, `081`, `085`, `086`, and `102`.
- Non-goals: no new sandbox driver; no network isolation; no credential vault;
  no resource/process limits; no new dependency, table, primitive, marketplace,
  plugin abstraction, second policy system, or Edictum behavior change.
- Allowed scope: core sandbox validator extraction, API Agent/settings
  validation for referenced sandbox profiles, dashboard sandbox default, tests,
  dogfood records, and review artifacts.
- Verification: `ductum spec contract-check ductum specs/current/sandbox-settings-runtime-alignment --path`,
  `ductum spec drift-review ductum sandbox-settings-runtime-alignment`, package
  tests, build, `git diff --check`, and adversarial slop review.
- Drift handling: record a decision before rejecting unreferenced future
  SandboxProfile shells, adding a driver, changing Edictum policy, adding
  dependencies/tables/primitives, or redesigning Settings.
- Settings save and validate both route through `validateSettingsAgentRuntimeRefs`;
  D077 factory-scope deferrals are closed later by API accept/dispatch against
  the concrete spec project before any run/session is created.

## Behavior Contract

- Agent create with `sandboxRef` to unsupported provider/mode must fail loudly before persisting the Agent.
- Agent update with `sandboxRef` to unsupported provider/mode must fail loudly and preserve the existing Agent row.
- Settings save with an Agent `sandboxRef` to unsupported provider/mode must fail visibly and preserve persisted YAML.
- Settings validate with an Agent `sandboxRef` to unsupported provider/mode must fail visibly without mutating runtime state.
- Referenced sandbox profiles with unsupported filesystem claims must fail through the shared runtime validator before Agent write or settings save.
- Referenced sandbox profiles with unsupported network, credential, resource, or process claims must fail through the shared runtime validator before Agent write or settings save.
- Referenced sandbox profiles with unsupported provider/mode or unsupported claims must fail through the shared runtime validator before API accept creates a run.
- Unreferenced SandboxProfile resources must preserve accepted config-shell behavior even when their provider/mode is not runtime-supported.
- Agents without `sandboxRef` must preserve existing legacy runtime validation and settings behavior.
- Settings "Add sandbox" must create a runtime-supported `host/worktree` SandboxProfile by default.
- Dashboard structured sandbox controls must not claim network, credential, resource, or process enforcement.
- The implementation must reuse core sandbox runtime validation rules instead of duplicating provider/mode checks in the API or dashboard.
- Tests must prove failure behavior, preservation behavior, and runtime validator reuse, not only schema shape.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did bad referenced sandbox profiles produce loud failures before Agent persistence or settings save?
- Did unreferenced future SandboxProfile shells preserve accepted config-shell behavior?
- Did the dashboard stop generating unsupported sandbox defaults?
- Did the implementation avoid duplicate sandbox runtime validation logic?
- Did tests attack swallowed errors and silent fallback after unsupported sandbox refs?
- Did it avoid fake sandbox branches, dead config branches, or future features?
- Did legacy no-ref behavior remain unchanged?

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-SANDBOX-SETTINGS-RUNTIME-ALIGNMENT.md](P1-SANDBOX-SETTINGS-RUNTIME-ALIGNMENT.md) | core/api/dashboard | Referenced SandboxProfile validation and Settings default alignment | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `QhUlji0raArS`.
- Task imported into Ductum: `ZE8Cw3cf5Axi`.
- Run opened in Ductum: `rRxwvWGliaOM`.
- Decision recorded in Ductum: `mC69po14iIha`.
- Verification evidence recorded: `5FluG4Q0SYs_`.
- Final verification evidence recorded: `luQkVHe7g_7Q`.
- Final slop review evidence recorded: `sFxz9UGRLZLE` (PASS).

## Verification

```sh
ductum spec contract-check ductum specs/current/sandbox-settings-runtime-alignment --path
ductum spec drift-review ductum sandbox-settings-runtime-alignment
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm --filter @ductum/dashboard test
pnpm --filter @ductum/cli test
pnpm build
git diff --check
```

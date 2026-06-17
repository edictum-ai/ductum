# P1 - Sandbox Settings Runtime Alignment

Implement the narrow alignment slice for referenced SandboxProfile validation
and Settings sandbox defaults.

## Decision Trace

- Decisions: `053`, `056`, `057`, `058`, `059`, `060`, `064`, `066`, `077`,
  `078`, `081`, `085`, `086`, and `102`.
- Non-goals: no new sandbox driver; no network isolation; no credential vault;
  no resource/process limits; no new dependency, table, primitive, marketplace,
  plugin abstraction, second policy system, or Edictum behavior change.
- Allowed scope: core sandbox validator extraction, API Agent/settings
  validation for referenced sandbox profiles, dashboard sandbox default, tests,
  dogfood records, and review artifacts.
- Drift handling: record a decision before rejecting unreferenced future
  SandboxProfile shells, adding a driver, changing Edictum policy, adding
  dependencies/tables/primitives, or redesigning Settings.
- D077 factory-scope project-ref deferrals must be closed at API accept and
  dispatch boundaries against the concrete spec project.

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

## Implementation Notes

- Prefer extracting a core profile-shape validator from `sandbox-runtime.ts`
  over retyping host/worktree rules in API code.
- Keep existing dispatch-time preparation checks for working directory and
  worktree manager.
- Keep unsupported advanced sandbox fields editable through raw YAML, but fail
  when an Agent references them.
- Preserve `process` claims so referenced unsupported process isolation is a
  loud runtime-compatibility failure, not a normalized-away no-op.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Did bad referenced sandbox profiles produce loud failures before Agent persistence, settings save, settings validate, API accept, or dispatch?
- Did unreferenced future SandboxProfile shells preserve accepted config-shell behavior?
- Did the dashboard stop generating unsupported sandbox defaults?
- Did the implementation avoid duplicate sandbox runtime validation logic?
- Did tests attack swallowed errors and silent fallback after unsupported sandbox refs?
- Did it avoid fake sandbox branches, dead config branches, or future features?
- Did legacy no-ref behavior remain unchanged?

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

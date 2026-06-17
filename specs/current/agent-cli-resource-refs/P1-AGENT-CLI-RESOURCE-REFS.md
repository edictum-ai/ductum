# P1 - Agent CLI Resource Refs

Add first-class Agent resource-ref flags to `ductum agent register` and
`ductum agent update`.

## Decision Trace

- Decisions: `053`, `054`, `056`, `057`, `058`, `059`, `060`, `064`, `066`,
  `067`, `068`, `069`, `070`, `071`, `072`, `074`, `075`, `077`, `078`, `082`,
  `085`, `088`, `089`, `096`, and `097`.
- Non-goals: no dependency, table, primitive, marketplace, plugin abstraction,
  second policy system, runtime policy change, or new behavior for `toolsRef`
  and `policyRef`.
- Allowed scope: CLI agent register/update option parsing, request payload
  shaping, operator-visible errors, focused CLI tests, docs/spec records, and
  evidence.
- Drift handling: record a new decision before adding ref clearing semantics,
  moving resource authority into the CLI, changing runtime dispatch behavior,
  adding tables, or giving `toolsRef` / `policyRef` runtime behavior.

## Behavior Contract

- `ductum agent register --model-ref ... --harness-ref ...` must preserve the
  operator-provided refs in the API payload as Agent `resourceRefs`.
- `ductum agent register --model-ref ... --harness ...` must preserve
  `resourceRefs.modelRef` in the API payload and must preserve the explicit
  direct harness.
- `ductum agent register --model ...` with no ref flags must preserve the
  legacy `vercel-ai` harness default.
- `ductum agent register --model-ref ...` without `--harness` or
  `--harness-ref` must fail loudly before the API call.
- `ductum agent register` must reject `--model` with `--model-ref` before the
  API call.
- `ductum agent register` must reject `--harness` with `--harness-ref` before
  the API call.
- `ductum agent update --sandbox-ref ...` must preserve existing refs by merging
  with them instead of deleting unspecified refs.
- `ductum agent update` must reject direct/ref conflicts before the API call.
- Legacy `ductum agent update --model/--harness` behavior must remain
  unchanged when no ref flags are present.
- CLI output must preserve visible Agent `resourceRefs` after register/update
  through the existing Agent summary.
- The CLI must not silently ignore a provided ref flag.
- The CLI must not silently replace API/dispatcher runtime authority by
  validating config-resource existence, kind, project scope, or malformed
  resource specs itself.
- `toolsRef` and `policyRef` must be preserved as metadata-only refs and must
  not add policy runtime behavior.
- The implementation must not add a dependency, table, primitive, marketplace,
  plugin abstraction, or second policy system.
- Tests must preserve behavioral evidence through API payloads and
  operator-visible errors, not only command option shape.

## Implementation Notes

- Add ref flags for `modelRef`, `harnessRef`, `workflowProfileRef`,
  `sandboxRef`, `systemPromptRef`, `toolsRef`, and `policyRef`.
- Keep legacy `agent register --model ...` behavior exactly as before,
  including the `vercel-ai` default harness.
- When any ref flag is present, build `resourceRefs` explicitly and include it
  in the API payload.
- Do not call config-resource endpoints from the CLI to validate refs.
- For update, fetch the target Agent as today and merge new ref flags with
  `target.resourceRefs`.
- Add a focused test file rather than growing oversized command tests.

## Slop Review

- Did every Behavior Contract item get a behavioral test or explicit evidence?
- Are tests behavioral, not just shape checks?
- Did ref flags reach the API payload instead of being parsed and ignored?
- Did a configured bad direct/ref mix fail before the API call?
- Did `--model-ref` avoid legacy harness fallback unless a harness source is
  explicit?
- Did update merge refs instead of wiping unspecified refs?
- Did legacy register/update behavior stay unchanged when refs are absent?
- Did the implementation move runtime resource authority into the CLI?
- Did it add fake provider branches, a marketplace, a plugin abstraction, a new
  table, or a second policy system?
- Did `toolsRef` or `policyRef` accidentally gain runtime behavior?

## Verification

```sh
ductum spec contract-check ductum specs/current/agent-cli-resource-refs --path
ductum spec drift-review ductum agent-cli-resource-refs
pnpm --filter @ductum/cli test
pnpm --filter @ductum/core test
pnpm --filter @ductum/api test
pnpm build
git diff --check
```

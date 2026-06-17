# Agent CLI Resource Refs

## Intake

The Agent resource runtime is now backed by config-resource refs, and the API,
settings YAML, manifest import, dispatcher, doctor checks, run snapshots, and
runtime preflights all understand those refs. The direct CLI flow still treats
legacy `--model` and `--harness` as the primary creation path.

This slice makes `ductum agent register` and `ductum agent update` able to
author Agent `resourceRefs` directly while preserving legacy behavior when refs
are absent.

## Grill Questions

- Should the CLI validate that refs exist? No. The API and dispatcher already
  own scoped resource resolution and runtime validation.
- Should `agent register --model-ref` keep the old implicit harness default? No.
  A resource-backed model must require an explicit harness source so bad refs do
  not silently fall back to legacy harness config.
- Should `agent update --sandbox-ref` replace all refs? No. Updating one ref
  should merge with existing refs and leave unspecified refs intact.
- Should this add clear flags for removing refs? No. Clearing refs needs a
  separate decision so it does not accidentally erase runtime sources.
- Should `toolsRef` or `policyRef` gain runtime behavior? No. They remain
  metadata-only in this slice.

## Decisions

- Add decision `097` for Agent CLI resource refs.
- Add resource-ref flags to `ductum agent register` and `ductum agent update`.
- Preserve direct `--model` / `--harness` behavior with the legacy harness
  default when no ref flags are used.
- Reject direct/ref conflicts before the API call.
- Merge update ref flags with existing Agent refs.
- Defer ref existence and scope validation to existing API/runtime code.

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
- Verification: `ductum spec contract-check ductum specs/current/agent-cli-resource-refs --path`,
  `ductum spec drift-review ductum agent-cli-resource-refs`,
  CLI tests, core/API tests for regression coverage, build, diff check, and
  adversarial slop review.
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

## Execution Order

| # | Prompt | Package | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|---|
| 1 | [P1-AGENT-CLI-RESOURCE-REFS.md](P1-AGENT-CLI-RESOURCE-REFS.md) | cli | Agent register/update resource-ref flags and tests | [x] | - |

## Dogfood Record

- Spec imported into Ductum: `myL08yBJILFP`.
- Task imported into Ductum: `Va8GE9QBkfMW`.
- Run opened in Ductum: `rI1MDxrcmwtp`.
- Decision recorded in Ductum: `FIwX28syXSYp`.
- Evidence recorded: `3fwYdk8DvS1e`, `uQANqY-to3Ns`, `rO3vCb3B6ph0`,
  `sYUzyG33BNg2`, `jkrnG8CEIuU4`.
- Final slop review: Claude PASS on the latest working tree.

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

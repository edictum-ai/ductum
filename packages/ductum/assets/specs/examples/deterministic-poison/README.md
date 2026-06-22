# deterministic-poison

Minimal quarantine proof spec for local dogfood factories started with
`DUCTUM_MOCK_AGENT_CALLS=1`.

This sample asks the mock harness to emit the same non-recoverable crash reason
on every attempt. After the retry budget is exhausted, the run should enter the
distinct `quarantined` terminal state and stay visible in the needs-operator
surface.

## Decision Trace

- decisions/173: deterministic poison must become `quarantined`, not generic
  `failed`.
- decisions/174: Phase 2 still needed a live deterministic quarantine proof
  fixture.

## Behavior Contract

- Runtime must fail loudly if the factory is not started with mock-agent calls;
  evidence: startup logs must show `mock agent calls`.
- Dispatcher must preserve the same non-recoverable fail reason across retry
  runs; evidence: run logs/status show the stable poison reason.
- Quarantine must leave the task active and remove it from the ready dispatch
  queue; evidence: `ductum watch --once` shows a needs-operator item.
- Repository scope must not mutate files; evidence: `git diff` stays empty.

## Verification

- Start a local factory with `DUCTUM_MOCK_AGENT_CALLS=1`.
- `ductum spec import assets/specs/examples/deterministic-poison --project factory`
- Watch the task exhaust retries and surface as quarantined.

## Drift Handling

- Do not turn this into a production harness behavior. The poison marker belongs
  only to the deterministic mock harness path.

## Slop Review

- Test runtime behavior with `ductum status` / `ductum watch --once`; require
  explicit evidence that the attempt is `quarantined`, not `failed`.
- Attack missing or invalid mock-agent startup and confirm the failure stays
  loud instead of pretending a production harness can use the marker.
- Check for scope creep: no repository diff, no provider call, no hidden retry
  loop after quarantine.

## Execution Order

| # | Prompt | Package | Scope | Notes | Depends On |
|---|---|---|---|---|---|
| 1 | [P1-DETERMINISTIC-POISON.md](P1-DETERMINISTIC-POISON.md) | repo | none | Force repeated deterministic mock failure. | - |

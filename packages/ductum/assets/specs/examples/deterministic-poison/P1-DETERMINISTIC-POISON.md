## Decision Trace

- decisions/173: recurring non-recoverable failures quarantine the run after
  retry exhaustion.
- decisions/174: live Phase 2 dogfood needed a deterministic poison fixture.

## Behavior Contract

- Runtime must crash through the mock harness with the exact fail reason below;
  evidence: attempt logs show the stable poison reason.
- Dispatcher must retry the task until retry budget exhaustion; evidence:
  `ductum status` shows retry progress before quarantine.
- Run terminal state must become `quarantined`, not `failed`; evidence:
  `ductum watch --once` lists a needs-operator quarantined attempt.
- Task scope must not edit repository files; evidence: the worktree diff stays
  empty.

## Verification

- `ductum status`
- `ductum watch --once`

## Drift Handling

- Keep the marker line unchanged unless the mock harness fixture contract
  changes in the same commit.

## Slop Review

- Test runtime behavior through the operator CLI and require explicit evidence
  for the `quarantined` terminal state.
- Attack missing or invalid mock-agent startup and confirm it fails loudly
  instead of silently using real providers.
- Check for duplicate retries after quarantine; the task must not keep
  dispatching once the poison state is reached.

DUCTUM_MOCK_POISON: deterministic poison: quarantine fixture invariant failed

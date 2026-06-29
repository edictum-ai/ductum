# Post-P9 Hardening

## Status

Parked post-P9 polish backlog.

Created after operational-model-redesign P9 PASS on 2026-06-09. These stages
are not blockers to the operational model redesign closeout. Ductum may dogfood
them, but each stage still needs its own prompt, scope, and verification before
implementation.

## Source

- `specs/current/operational-model-redesign/README.md`
- `specs/current/operational-model-redesign/P9-FINAL-REVIEW-AND-DEMO.md`
- `decisions/166-operational-model-redesign-closeout.md`
- Latest P9 delta review result: PASS on 2026-06-09.

## Non-Goals

- Do not implement these items in the closeout commit.
- Do not reopen P9 acceptance.
- Do not add new providers, harnesses, workflow semantics, cloud coordination,
  marketplace behavior, or dependencies without a separate decision.
- Do not make `ductum.yaml` authoritative again.

## Execution Order

| # | Stage | Scope | Status |
|---|---|---|---|
| 0 | P0 workflow validity and secret wording | Repair targeting plus secret-message copy | done/pass |
| 1 | P1 safety/honesty hardening | Truthful readiness, output, migration, and evidence surfaces | parked |
| 2 | P2 model/API architecture seams | Public/internal contract boundaries and identity seams | parked |
| 3 | P3 cleanup debt | Stale docs, legacy wording, duplicate code, and file-size cleanup | parked |
| 4 | P4 process directives | Dogfood rules, agent instructions, and verification directives | parked |

## Future Backlog

`post-source-of-truth-backlog.md` captures follow-on ideas to consider after the
Factory Settings source-of-truth arc is complete. It is not part of the active
P-stage order and should not be implemented without a separate prompt.

## P0 - Workflow Validity Targeting And Secret Wording

Scope:

- Tighten `workflow_validity` Repair items so they target the exact Project,
  Workflow, record, and field instead of collapsing into vague global setup
  failures.
- Make multi-Project workflow failures readable when one Project is broken and
  another can continue.
- Review secret-related CLI/API/dashboard messages so they name fields and
  environment-variable references without implying secret values belong in
  config, logs, evidence, exports, or public JSON.
- Keep suggested actions specific and non-secret-bearing.

Acceptance:

- Operators can identify the exact workflow reference to fix.
- Secret-message wording stays consistent across Repair, setup, config
  validation, migration, and public errors.
- No secret values are requested, echoed, stored, or displayed.

## P1 - Safety And Honesty Hardening

Scope:

- Keep Repair, `doctor`, `status`, queue, and dashboard readiness output from
  overstating whether the factory can dispatch work.
- Preserve the P9 rule that valid Projects may continue when another Project is
  broken.
- Harden migration and legacy Attempt summaries so partial historical state is
  described honestly.
- Keep prose-success signals from becoming implicit PASS evidence.
- Verify public output redaction across CLI, API, dashboard, logs, run
  activity, evidence, and exports.

Acceptance:

- Blockers remain operator-visible and actionable.
- "Ready" never means "some hidden prerequisite is still broken."
- Legacy or external work is labeled honestly.

## P2 - Model/API Architecture Seams

Scope:

- Sharpen the public/internal DTO boundary for the operator model.
- Reduce duplicate mappers, formatters, and redaction paths where they now
  encode the same public contract.
- Keep Ductum Model IDs, provider model IDs, Agent names, Harness adapter keys,
  and resource references distinct in API and UI contracts.
- Keep debug/legacy resource routes available only as explicit compatibility
  paths, not as the normal operator API.

Acceptance:

- API consumers can tell operator-facing fields from internal runtime fields.
- Resource identity errors identify the exact source field and expected
  identity type.
- Shared public contract types remain the source of truth.

## P3 - Cleanup Debt

Scope:

- Remove stale mission wording and old bootstrap/P5 assumptions from docs that
  were not touched during closeout.
- Retire or isolate legacy public wording that still leaks into normal help,
  docs, dashboard labels, or tests.
- Split files that should no longer remain large or grandfathered.
- Remove duplicate test helpers and drifted examples introduced while closing
  P7-P9.
- Keep generated/build artifacts out of source-oriented cleanup unless a
  separate release task needs them.

Acceptance:

- Normal docs teach the post-P9 operator model.
- Debug-only surfaces are clearly labeled.
- File-size and docs checks stay green.

## P4 - Process Directives

Scope:

- Update agent-facing instructions for post-P9 dogfooding.
- Define which post-P9 stages should run through Ductum and which should stay
  operator-direct.
- Keep `ductum-cli` as the supported path for Ductum state reads/writes.
- Name verification gates for docs-only, runtime, dashboard, and release work.
- Require decisions before scope drift, new dependencies, workflow semantic
  changes, secret storage changes, or public contract weakening.
- Require every stage-close residual to be pinned by a fix, a test pinning
  current behavior, or a decision reference, per
  `docs/STAGE_RESIDUAL_PINNING.md` (D185).

Acceptance:

- Future agents can pick up post-P9 hardening without reading stale bootstrap
  mission headers.
- Dogfood stages have explicit gates and do not claim done before evidence.
- Process directives reinforce the operational model instead of reintroducing
  legacy YAML/resource mental models.
- Stage templates mention residual pinning, and a stage that closes with
  unpinned residuals fails closed.

## Stage Template

Every new P-stage under `specs/current/post-p9-hardening/` (and any later arc
that claims a terminal status) carries these sections:

- `## Problem` — the concrete failure mode this stage closes.
- `## Scope` — what is in and out of this stage.
- `## Decision Trace` — decisions and prior stages this stage depends on.
- `## Behavior Contract` — numbered, testable requirements.
- `## Non-Goals` — tempting work that does not belong here.
- `## Slop Review` — attack vectors for weak evidence.
- `## Acceptance` — observable outcomes required before the stage can close.
- `## Verification` — commands that must pass.
- `## Residuals` — required. List each open finding with a pin (fix, test, or
  decision) per `docs/STAGE_RESIDUAL_PINNING.md`, or write "None." explicitly.
  A residual without a pin is a blocker, not a residual.

Stages may rename or merge sections to fit the work, but the `## Residuals`
section is mandatory from D185 forward.

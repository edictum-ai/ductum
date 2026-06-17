# FINDINGS

**Schema conformance (contract §5.3 / D135 §7):** ✅
- `ExitDemoRunEvidence` shape matches the contract verbatim — `demoName` literal-typed, `timeline` 7-phase ordered tuple, `operatorActions` positional 2-tuple, `schemaVersion: 1`. `evidence-kinds.ts:48-62`
- Registered in `EVIDENCE_KINDS` map (`evidence-kinds.ts:81`) and union type (`:69`), so `getEvidenceKind`/`validateEvidencePayload` route to it without code path changes.

**Runtime validation:** ✅ rigorous
- Phases must appear in the exact 7-element order (`isExitDemoTimeline`, `:166-181`).
- `operatorActions` checked positionally for `["browser_auth","approve_click"]` (`:142-145`) — matches contract.
- `totalSeconds` validated as non-negative finite number; all string fields rejected when empty (`isString` at `:191`).
- Schema version pinned to literal `1`.

**Validator gaps (minor, worth flagging — not blockers):**
- `osHash`/`hostnameHash` only checked for non-empty string — validator cannot enforce that they're actually hashed. The "hashed identifiers only" privacy invariant lives in the (not-yet-shipped) `exit-demo.mjs`. When that script lands, a unit test should assert it never writes raw hostnames into the payload.
- `mergedCommitSha` accepts any non-empty string (no `/^[0-9a-f]{7,40}$/` shape check). Tolerable — the harness sources it from `git log`.
- Validator does not assert `totalSeconds < 600`. Contract §5.2 says the harness asserts the budget — that's correct placement (the kind itself shouldn't block recording an over-budget honest failure for diagnosis).

**API allow-list (`packages/api/src/routes/runs.ts:51-60`):** ✅
- Adds `exit_demo.run` to `CUSTOM_EVIDENCE_KINDS` only; the outcome-bearing branches (`external-outcome`, `bakeoff-candidate-outcome`, `verify`, `internal-review`) are untouched.
- `customPayloadHasSuccessSignal` (`execution-integrity-evidence.ts:81`) still recursively scans the payload, so `exit_demo.run` is not exempted from the prose-success-signal guard. The sample `promptText` ("Append the line …") doesn't trip the regex; future operators authoring sample specs whose prompt includes "PASS" / "verification passed" would be blocked. Acceptable — the bundled `hello-readme` prompt is load-bearing per contract §Drift, and any change requires a recorded decision.
- Pre-existing inconsistency unchanged: typed registry uses `operator.note` (dot) but API allow-list lists `operator-note` (dash). Not introduced here, but worth a follow-up cleanup.

**CLI test hardening (`auth-codex-copilot.test.ts:190`):** ✅
- `DUCTUM_NO_BROWSER: '1'` is injected only into the test `makeCtx` env (with `...env` spreading after, so individual tests can override). No production code path touched. Continues the pattern from `19abb43`.

**No real agent calls / no real browser opens in tests:** ✅
- The diff only touches a unit test that constructs a fake `CliContext`; no network or `open()` invocation added. `createMockApi()` remains the API layer.

**Tests:** ✅
- Sorted-keys assertion updated to include `'exit_demo.run'` first (`evidence-kinds.test.ts:8`).
- Positive test exercises full happy-path payload; negative test mutates `operatorActions` length to 3 — confirms the positional/length check fires. Could be strengthened with negatives for: wrong phase order, missing phase, non-`bootstrap-redesign-p5` `demoName`, `schemaVersion: 2`. Not blocking.

**Scope of this diff vs. P5 contract:**
- This is the *typed-registry slice only*. The contract also requires `scripts/demos/exit-demo.mjs` (≤200 LOC), `specs/current/bootstrap-redesign/EXIT-DEMO-PROTOCOL.md`, and the bundled `hello-readme` sample spec. None are in this diff. P5 cannot close on this diff alone — but as the first implementation slice, the registry-first ordering is correct.

# VERDICT

**PASS** — first slice is correctly scoped, contract-faithful, well-validated, and does not weaken existing outcome validation or production browser behavior. Land it; expect follow-up diffs for `exit-demo.mjs`, the protocol doc, and the bundled sample spec before the arc closes.

# SUGGESTED CMDS

```
pnpm --filter @ductum/core test -- evidence-kinds
pnpm --filter @ductum/api test -- runs
pnpm --filter @ductum/cli test -- auth-codex-copilot
pnpm -w typecheck
pnpm -w lint
node scripts/check-file-size.mjs
```

Add a negative-test case for wrong phase order in `evidence-kinds.test.ts` before P5 closes — current tests don't lock in the strict ordering invariant.

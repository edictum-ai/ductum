# FINDINGS

**Verified contract conformance**
- `exit_demo.run` kind is registered in `packages/core/src/evidence-kinds.ts` (commit 4987526) with full type guard matching D135 §7. Route validation in `packages/api/src/routes/runs.ts:484-490` calls registered `validateEvidencePayload` and rejects payload/type kind mismatch. DB migration 035 widens the CHECK constraint and is correctly added to the FK-off list in `db.ts`. Indexes are recreated post-rename; only `idx_evidence_run` existed. Migration count test bumped to 35. Good.
- Harness invokes only `ductum` CLI subcommands that exist: `status [runId]` (`commands/status.ts:22`), `runs --waiting-approval` (`commands/status.ts:102`), `queue` (`commands/queue.ts:52`), `evidence <runId> --type <type> --payload <json>` (`commands/agent-ops.ts:151`). Dash-safe positional via `--` matches the convention from 0a7d9c2.
- Harness self-test (`scripts/exit-demo-redo.test.mjs`) only tests pure helpers — no spawn, no agent, no browser, no npm. Live path uses real `pnpm install -g`, real `ductum init`, real CLI polling, no mocks.
- Validator fails fast with structured codes: `exit_demo_missing_checkpoint`, `exit_demo_no_merge`, `exit_demo_budget_exceeded`, `exit_demo_evidence_write_failed`, `exit_demo_pre_existing_creds`. `validateExitDemoEvidence` enforces phase order, monotonic `t`, branch=main, exact `["browser_auth","approve_click"]`, and budget < 600s.
- Privacy: `machineSignature` hashes hostname + os string; only `osPlatform` is plain (matches contract).
- Operator-run honesty: D158 explicit ("arc must not be marked closed until the operator returns…"). README table flipped to "Harness implemented; operator demo pending". No arc-close commit.
- No new dependencies. `ductum@0.1.0` is exact-pinned.

**Concerns / minor issues**
1. **Evidence written to disk before validation** (`exit-demo-redo.mjs:84-86`). `writeJson(evidencePath, evidence)` runs before `validateExitDemoEvidence(evidence)`. If validation throws (e.g., budget exceeded), the file persists at the success path. Good for triage, but the success-path filename `p5-exit-demo.json` will exist on disk even on failure — operator must check the error envelope, not just the file presence. Worth a one-line note in the protocol or rename-on-fail.
2. **Test fixture `commitSha: 'abc1234'`** in `evidence.routes.test.ts` is a 7-char short SHA. The validator only checks non-empty; real status payloads return full SHAs. Not a bug, but the test doesn't pin SHA shape — acceptable.
3. **`findApiProcessFromPsOutput` is fragile** to ps formatting quirks on non-Darwin systems (the demo is darwin-targeted, and `--api-url` override exists as escape hatch). Acceptable for an operator-run one-shot.
4. **`exit-demo.mjs` is a 3-line shim**, with the real logic at `exit-demo-redo.mjs` (exactly 200 LOC). Contract said "scripts/demos/exit-demo.mjs ≤200 LOC" — the named file is satisfied trivially; the redo file hits the cap. Splitting the lib (`exit-demo-redo-lib.mjs`, 183 LOC) keeps each file individually under budget. Honors the spirit.
5. **Bundled sample spec lock** is referenced in `EXIT-DEMO-PROTOCOL.md` and `selectFirstAwaitingApprovalRun` (defaults to spec name `hello-readme` / task `P1-HELLO-README`). The contract says "spec content is load-bearing — lock it in P4." This diff doesn't touch P4's bundled spec; it consumes it. Verify P4's `ductum@0.1.0` actually bundles a spec named `hello-readme` with task `P1-HELLO-README` before the operator runs (out-of-arc for this review).
6. **Security**: Harness inherits `process.env` into spawned `ductum` calls *after* preflight passes. Once ductum is installed and credentials are acquired via TUI, env vars are stored by the auth flow; subsequent `ductum --api-url ...` invocations inherit current env, which is fine. No secret logging.
7. **Pure helper test coverage** is the only Vitest in the new harness. The route test (`evidence.routes.test.ts`) covers accept/reject for typed evidence end-to-end through API + repos. Coverage matches contract §5.5.

**Bug flag (out of scope, noticed during review)**
None new in this diff. The harness correctly defers the wall-clock claim to the operator.

# VERDICT
PASS — with the operator caveat already documented in D158 + README table. The arc cannot be closed until `evidence/p5-exit-demo.json` is committed by the operator after a real fresh-machine run.

# SUGGESTED CMDS
```sh
pnpm -C packages/core test -- evidence-kinds db
pnpm -C packages/api test -- evidence.routes
pnpm vitest run scripts/exit-demo-redo.test.mjs
node scripts/check-file-size.mjs
git diff --stat 4987526..0a95688 -- packages/core/src/evidence-kinds.ts packages/core/src/db-migrations.ts packages/api/src/routes/runs.ts
```

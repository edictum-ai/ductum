# Decisions needed from you — Ductum redo

> Consolidated forks. Each has a recommendation; the call is yours.

## 1. Recovery granularity: real reattach to live harness sessions vs delete reattach and resume from durable checkpoint only

- **Recommendation:** Delete the dead tryReattach interface and the overstated startup log; recovery is resume-from-durable-checkpoint only. Optionally keep a Codex-only reattach later as a latency optimization, never as the foundation.
- **Why:** No shipped adapter implements tryReattach (dispatcher-reconcile.ts:134-138) — it is scaffolding that misleads the operator. Resume-from-durable-state needs no adapter cooperation and works even when the original session is also dead. Building real reattach is more work for a weaker guarantee.

## 2. Control/data-plane boundary: physical core-controlplane / harness-dataplane package split now vs logical invariant first

- **Recommendation:** Logical boundary first — enforce 'data plane holds no authoritative state' inside existing packages; carve the physical split only once a remote executor exists.
- **Why:** Scope Rule: the justifying flow (remote dispatch) does not exist yet. The invariant gets ~90% of the benefit (it is what makes the Bundle seam meaningful and unblocks recovery/exactly-once) without premature package churn.

## 3. Evidence content hash as primary key vs indexed side column with idempotency-key dedup

- **Recommendation:** Keep the existing id column, add content_sha as an indexed side column, dedup on UNIQUE(run_id, idempotency_key). content_sha is the cassette key, not the DB PK.
- **Why:** Content-hash-as-PK is a destructive SQLite table rebuild that breaks every FK to evidence.id, and would wrongly merge identical payloads from genuinely different attempts. The idempotency axis (jobAttemptId:stage:kind) is the operationally correct dedup; a side column is an append-only migration with zero reference churn.

## 4. Tamper-evidence scope: cross-run cryptographic hash-chain now vs the two cassette traps (manifest checksum + per-artifact content address) now, chain later

- **Recommendation:** Ship the two cassette traps now; defer the cross-run chain.
- **Why:** Per-artifact content-addressing already makes any single edit detectable. A global-ordering chain forces read-before-write on every append, which is idempotency-hostile and fights the exactly-once design. Global ordering is a should, not a must.

## 5. Poison/deterministic failure: distinct quarantined terminal state vs fold into failed

- **Recommendation:** Add a distinct quarantined state, entered on exhausted retry budget with deterministic (non-transient) classification.
- **Why:** Folding them lets a deterministically-failing task silently re-loop, burn the retry budget and the bill, and head-of-line block. A distinct state makes it a visible inbox item and removes it from the ready queue. Default to transient (retry) on ambiguity; escalate only on repeated identical-gate failure.

## 6. Extension loading: closed typed registry vs dynamic load-arbitrary-code-from-disk plugin loader for v1

- **Recommendation:** Closed registry with a typed extension point; operator-allowlisted explicit path/package, manifest-declared, capability-validated, deny-by-default. No node_modules auto-discovery. A signed/sandboxed loader is a separately-justified later decision.
- **Why:** This is a security product (C1-C7). An in-process extension runs with full trust on the authorize_tool path — a malicious/buggy plugin could bypass the moat. A closed registry satisfies every current dogfood flow (add Codex, add container driver) without arbitrary code loading.

## 7. Model credential (ANTHROPIC_API_KEY): scoped FactorySecret vs stay ambient

- **Recommendation:** Make it a named FactorySecret the broker injects only when a harness capability descriptor declares it needs it.
- **Why:** Leaving it ambient re-opens the exact leak being closed (claude.ts:187 spreads process.env). Special-casing it as ambient makes the boundary descriptor a half-truth. Cost is a one-time onboarding step (doctor/init wizard) worth the honest boundary.

## 8. Container SandboxDriver in this redo vs interface-only

- **Recommendation:** Ship the SandboxDriver interface + host driver now; ship the real container driver as the final proof step, not a v1 blocker.
- **Why:** Scope Rule: the interface is justified now (the broker makes the boundary descriptor meaningful and the seam-proof needs a second driver to register), but a real Docker driver (image mgmt, worktree mounting, network policy) is significant work and the laptop dogfood runs fine on host. Sequencing it last keeps every earlier step shippable.

## 9. Postgres/Redis scale-up rung now vs StateStore/Queue boundary only

- **Recommendation:** Build only the boundary + SQLite/in-process impls now as a 1:1 zero-behavior-change wrapper; name Postgres/queue as a future rung, do not implement.
- **Why:** No remote-dispatch/multi-node flow exists, and activeSessions holds non-serializable live objects so a real PgQueue cannot work until that is strangled. The boundary still pays for itself via the startup schema-version gate alone.

## 10. Onboarding surface: shipped ductum onboard command vs host-side Claude skill

- **Recommendation:** Ship ductum onboard as a command; rewrite the skill to drive it. Onboard writes through the API (DB-as-truth), prints nothing to paste.
- **Why:** Today nothing ships in the binary — onboarding requires a host-side skill plus hand-pasted ductum.yaml and a nohup serve.mjs path. That is untestable, drifts from the supported ductum start / DB-as-truth path (P3 YAML removal), and cannot be a dogfood flow. The skill keeps its genuine value (deciding which detected test command is real).

## 11. llms-full.txt authoring contract: generate from live validators vs hand-write

- **Recommendation:** Generate from the live zod/TS types the API validates against, with a CI drift check that fails the build.
- **Why:** A hand-written contract is exactly how D152 yaml-validation drift happens — it describes fields the runtime rejects. Generating from the validators makes the contract incapable of drifting from enforcement, which is the whole point of handing it to autonomous agents.

## 12. Bakeoff / multi-candidate comparison UI: keep vs remove

- **Recommendation:** Default KEEP but flag for operator confirmation — it is real and tested (bakeoff-dashboard.test.tsx). If multi-candidate compare is no longer an intended flow under the current operator model, it is a clean REMOVE.
- **Why:** This is a product call, not a UI call. Bakeoff asks the operator to interpret raw candidate diffs (a legibility cost) and bakeoff itself is a DECIDE fork elsewhere in the inventory. Surface it rather than silently keep or cut.

## 13. Home IA: make Home the Inbox vs keep separate /approvals + /repair + /activity split

- **Recommendation:** Make Home the inbox spine (rename ProjectList.tsx -> Home.tsx) AND keep dedicated Activity/Approvals/Repair as deep views.
- **Why:** The D119 inbox principle and recent home/inbox commits point this way. A single prioritized landing queue is what lets one operator supervise many runs (the autonomous goal); the dedicated pages remain for depth, and this fixes the ProjectList-is-actually-Home naming trap.

## 14. Target/Resource backfill (REMOVE set): delete targets.ts/SqliteTargetRepo now vs gate on a one-time target_id backfill

- **Recommendation:** Gate the deletion on a one-time target_id backfill landing first; keep the migration CHECK constraints as historical ledger. Operator owns this, not an automatic delete.
- **Why:** Deleting the bridge before the data migrates would orphan references. The strangler rule is to retire the old path only after the new path is proven and the data is moved.


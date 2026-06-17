# P5 — Recovery Exit Demo Redo

## Problem

D109 named "fresh clone → merged commit < 10 min" as the recovery's
exit criterion. D131 acknowledged that wall-clock was never honestly
verified end-to-end against real agents (only against mocks, against a
machine where the operator had API keys configured, with bootstrap
prereq over-checking). The recovery shipped Outcome A *with that gap
explicit*. This stage closes it — and reframes it against the new
bootstrap flow: not "fresh clone," but "fresh machine, no repo, no
env vars, `pnpm install -g ductum`."

This is the only honest "factory ready" claim the recovery accepts.

## Scope

- A demo script and evidence harness in `scripts/demos/exit-demo.mjs`
  that times each phase of a real-machine run and emits a structured
  evidence row (per D135 §7 `worktree.snapshot`-shaped, but the
  payload kind is new: `kind: "exit_demo.run"`).
- A demo prose document at `specs/current/bootstrap-redesign/EXIT-DEMO-PROTOCOL.md`
  the operator follows verbatim. (The prose is part of P5; the
  *running* of the demo is operator-personal and cannot be dispatched.)
- A bundled sample spec (`hello-readme`) inside the published `ductum`
  package (already shipped in P4). The demo's first task is to import
  this spec and dispatch it.
- A new typed evidence kind `exit_demo.run` registered in
  `packages/core/src/evidence-kinds.ts` per D135 §7.

Does **not** add:

- A "perpetual exit demo" CI workflow. P5 is a one-shot operator
  proof, not an ongoing health check. (Continuous health is a future
  arc.)
- Any change to dispatcher / reviewer / approval / merge code paths.
  Those proved themselves in the recovery.
- Any waiver of the < 10 min wall-clock claim. If the demo doesn't
  hit it, the demo fails and the arc does not close until it does.

## Behavior Contract

### 5.1 The demo, exactly

This is the protocol. P5 ships when it runs end-to-end and emits
evidence rows that prove it ran.

**Pre-conditions (operator):**
- A physically fresh machine, OR a fresh user account, OR a clean VM /
  container snapshot. "Wiped node_modules and reset .env.local" does
  *not* qualify. The demo's evidence must include the OS/account
  identity used.
- No `ANTHROPIC_*`, `OPENAI_*`, `GH_TOKEN`, `COPILOT_*`,
  `CLAUDE_CONFIG_DIR` env vars set.
- No `~/.claude/` dir.
- Node 22+, pnpm 10+ installed (these are out of arc; document them
  as expected baseline, do not script their install).
- `ductum` published to npm via P4 with a fresh token.

**Steps (timed, wall-clock):**

1. **t0.** Operator runs `pnpm install -g ductum`.
2. **t1.** Operator runs `ductum init`. TUI walks:
   - directory → default `~/ductum`
   - project name → default `factory`
   - confirm
   - **Anthropic auth** → "Sign in to Claude now?" → yes → browser
     opens → operator approves → callback succeeds.
   - **Codex auth** → skip (default N).
   - **Copilot auth** → skip (default N).
   - **Agent picker** → only `claude-builder` selected.
   - **Start dashboard?** → yes → serve spawns → browser opens
     `/welcome`.
3. **t2.** Operator clicks "Import sample spec (hello-readme)" in
   `/welcome`. Spec lands.
4. **t3.** Operator returns to terminal. `ductum status` shows the
   first run picked up by the dispatcher and reaching
   `awaiting_approval`.
5. **t4.** Operator clicks **one** approve button in the dashboard.
6. **t5.** Run merges. `git -C ~/ductum/factory log -1` shows one
   commit on `main` from `claude-builder`.
7. **t6.** Demo exits cleanly. Operator captures the wall-clock
   timestamps t0…t6 as the evidence row payload.

**Acceptance:**
- t6 - t0 < 10 min (600s).
- One merged commit, on `main`, from the agent (not the operator).
- One approve click. No other operator action (besides browser auth
  consent at step 2 and approve at step 5).
- No env vars set on the demo machine before step 1.
- Evidence row of `kind: "exit_demo.run"` written to the factory's
  evidence ledger, captured to disk as `evidence/p5-exit-demo.json`.

### 5.2 Evidence harness (`scripts/demos/exit-demo.mjs`)

- A small CLI the operator runs *after* the demo to package the
  evidence. Reads:
  - `~/ductum/factory/ductum.yaml`
  - The factory's evidence ledger via `ductum-cli`
  - `git -C ~/ductum/factory log --format=...` for the commit SHA
  - System info (`os.platform()`, `os.release()`, hostname hash)
- Emits `evidence/p5-exit-demo.json` shaped as the
  `exit_demo.run` evidence kind.
- Asserts the < 10 min budget (fails the script if violated).

### 5.3 New evidence kind: `exit_demo.run`

Registered in `packages/core/src/evidence-kinds.ts`:

```ts
{
  kind: "exit_demo.run",
  schemaVersion: 1,
  data: {
    demoName: string,            // "bootstrap-redesign-p5"
    machineSignature: {          // privacy: hashed identifiers only
      osHash: string,
      osPlatform: string,
      hostnameHash: string
    },
    timeline: [
      { phase: "install_g", t: number },     // ms from t0
      { phase: "init_anthropic_auth", t: number },
      { phase: "serve_ready", t: number },
      { phase: "spec_imported", t: number },
      { phase: "run_awaiting_approval", t: number },
      { phase: "approve_clicked", t: number },
      { phase: "merged", t: number }
    ],
    totalSeconds: number,
    mergedCommitSha: string,
    mergedBranch: string,
    agentName: string,
    promptText: string,          // sample spec's task prompt
    operatorActions: string[]    // exactly: ["browser_auth", "approve_click"]
  }
}
```

### 5.4 D135 contract conformance

- `exit-demo.mjs` honors output mode (envelope when `--json`).
- Failure paths emit structured errors with codes:
  `exit_demo_budget_exceeded`, `exit_demo_no_merge`,
  `exit_demo_pre_existing_creds`, `exit_demo_evidence_write_failed`.

### 5.5 File-size budget

`exit-demo.mjs` ≤200 LOC. `evidence-kinds.ts` already exists; this
adds ≤40 LOC.

## Verification

- Unit tests for the harness's evidence-shape assertions.
- Unit tests for `exit_demo.run` kind validation.
- Existing tests still green; no behavior changes outside the new
  kind + the demo script.

## Exit Demo

The exit demo *is* this stage. Evidence:
`specs/current/bootstrap-redesign/evidence/p5-exit-demo.json`.

When this evidence row exists with `totalSeconds < 600` and
`operatorActions == ["browser_auth", "approve_click"]`, the
bootstrap-redesign arc closes. The recovery's deferred wall-clock is
honored. D131's untimed claim becomes a timed one.

## Drift Handling

- Demo runs in 11 minutes instead of 9 → do not weaken the budget.
  Diagnose where the time went, ship a follow-up that closes the gap,
  re-run. Honest failure is better than a fudged "ready" claim.
- Demo requires more than one approve click → diagnose root cause,
  fix, re-run. Multi-click means there's still a process gap the
  factory papers over.
- The sample spec's content drifts and changes the wall-clock → that
  spec's content is *load-bearing*. Lock it in P4 (bundled assets);
  changes need a recorded decision.
- The demo machine actually had ambient creds we missed →
  invalidates the run; re-run on a verifiably clean machine. Capture
  the cred-detection negative-evidence in the harness.

## Slop Review

- Attack any "exit demo" that runs from a cloned repo. The arc
  redefines the demo as global-install only.
- Attack any "exit demo" that pre-sets env vars before t0.
- Attack any "exit demo" timeline that skips a phase or omits the
  operator-actions list.
- Attack any "exit demo" whose evidence row was hand-written rather
  than emitted by `exit-demo.mjs`.
- Attack any wall-clock claim that rounds. Sub-second timestamps,
  raw `totalSeconds` field with no fudge.
- Attack any commit that closes this arc without
  `evidence/p5-exit-demo.json` on disk.
- Attack any commit that weakens the < 10 min budget without a
  recorded decision and an explicit acknowledgment that the recovery's
  exit criterion is being amended (which itself requires its own
  decision per D131's exit-demo non-amendment rule).

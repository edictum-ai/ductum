# Bootstrap Redesign

Turn Ductum from "clone the repo, run scripts in place" into "install the
tool, run it from anywhere, no env vars set." Six P-stages culminate in a
honest fresh-machine wall-clock — the only "factory ready" claim the
recovery (D131) accepts.

## Decision Trace

- D52 — supply-chain rules. Every new dep in this arc is exact-pinned,
  ≥7 days published, license-checked, integrity-recorded.
- D53 — factory resource model. `ductum init` writes a `factory.yaml`
  (or `ductum.yaml`) that conforms to the existing primitives. No new
  top-level resource types ship in this arc.
- D109 — recovery plan. Originated the "fresh clone → merged commit
  < 10 min" exit criterion that this arc completes.
- D125 — Pi remains blocked as a runtime dep. We port patterns
  (PKCE flow), we do not vendor `@mariozechner/pi-*` packages.
- D130 — multi-provider auth detection. Gave Anthropic / Copilot /
  OpenAI / Z.AI / OpenRouter detection. Did not ship the wizard slice
  for Codex or Copilot — this arc closes that gap (P2).
- D131 — recovery closeout (Outcome A). Names the wall-clock as
  intentionally deferred to *this* arc. P5 is that demo.
- D132 — D130 implementation. Ships the env-detection table and the
  Anthropic PKCE login. The current `ductum login` writes credentials
  to the Claude config file. That stays. The TUI flow in P1 reuses
  it; it does not rewrite it.
- D135 — agent-first control plane contract. Every new CLI surface in
  this arc ships against §1 (output mode), §2 (envelope), §3
  (structured errors), §9 (shared helpers). `ductum init` is the first
  *human-first* surface in the factory; it still emits envelope-shaped
  output to stdout when `--json`, but its TTY path is rich human UX.
- D147 — global install (this arc).
- D148 — `@clack/prompts` chosen as TUI lib (this arc).
- D149 — browser auto-open with `--no-browser` opt-out (this arc).
- D150 — `scripts/bootstrap.mjs` retained as legacy developer path
  (this arc).
- D151 — `@clack/prompts@1.2.0` supply-chain audit (this arc).
- D155 — P4 publishable package shape, unscoped `ductum`, bundle
  layout, pre-publish gates, and native SQLite install note.
- D156 — P4 token-detect hardening via explicit operator opt-in.
- D157 — P4 first-publish provenance drift: `ductum@0.1.0` is live;
  future OIDC/trusted-publisher setup follows after package creation.
- D158 — P5 exit-demo harness/protocol split: Codex ships the harness;
  the operator runs the clean-machine proof and the arc stays open until
  the wall-clock evidence passes.

## Behavior Contract

- **Stage scope.** Each P-file is independently shippable. P0 ships the
  TUI skeleton with no auth at all. P1, P2 add provider acquisition
  on top. P3 is the dashboard handoff. P4 is publish. P5 is the demo.
- **Drive Ductum via the CLI skill.** Any agent or operator
  modifying state (specs, runs, decisions) goes through
  `ductum-cli`. No curl, no SQLite, no hand-edited yaml. P5's
  demo prose reflects this.
- **Each stage exits on a real demo, not on tests-pass.** The exit
  criterion is named in each P-file's `## Exit Demo` block. P5's exit
  demo is the arc-level acceptance demo.
- **Honor D135's contract for new CLI surfaces.** The new `ductum init`
  command ships a human-first TUI for the default path *and* a
  `--json` mode that emits envelope-shaped progress events suitable
  for orchestrator agents driving the install non-interactively.
- **No new policy paths.** This arc adds CLI surface, not workflow
  enforcement. Enforcement stays where it is (embedded `@edictum/core`).
- **Stages merge in full before the next dispatches.** No interleaving.
- **No silent expansion of scope.** If a stage runs into something not
  in its P-file's `## Scope` section, record a Decision before
  expanding, per D60 drift handling.

## Scope (the arc as a whole)

- **In scope:** `ductum init` TUI; multi-provider auth acquisition
  (Anthropic PKCE, Codex login, GitHub Copilot OAuth) inside the TUI;
  browser auto-open to dashboard `/welcome`; dashboard `/welcome`
  route; `ductum` published as a global npm package; fresh-machine
  exit demo wall-clock.
- **Out of scope:** Pause/resume runs (depends on D121). Pi as runtime
  dep (D125 still blocked). Token rotation/re-auth (refresh-token
  handling beyond the initial wizard). AWS Bedrock / Google Vertex
  ambient creds (kept as future work per D130). Telegram fan-out
  (separate small follow-up to D139). Retrofitting existing CLI
  commands to D135's contract (separate backlog spec).
- **Explicit non-goal:** This arc does not change `@edictum/core`,
  workflow enforcement, dispatcher behavior, reviewer chain, approval
  gates, or merge orchestration. Those proved themselves in the
  recovery; touching them here would be drift.

## Verification

For each stage, the P-file lists its exit demo. Spec-level verification:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm -r test
git diff --check
node packages/cli/dist/index.js operator brief --json
node packages/cli/dist/index.js integrity --json
```

After P5: a fresh machine (no checkout, no env vars) runs
`pnpm install -g ductum && ductum init && ductum start`, the operator
clicks one approve button, and `git log -1` in the new project shows
one merged commit. Total wall-clock < 10 min, recorded as evidence in
the demo's `worktree.snapshot` evidence row (D135 §7).

## Drift Handling

- Any stage that needs to add a new dep beyond what its P-file lists:
  re-run the D52 audit (license + ≥7-day buffer + integrity hash) and
  record the audit as a follow-up decision before installing. The
  spec's D151 audit is the template.
- Any stage that needs to amend its exit demo: record the amendment
  as a follow-up decision. P5's exit demo wording is load-bearing
  (it's the recovery's exit) and may not be quietly weakened.
- Any stage that drops scope: explicit decision noting why. No
  silent removals.

## Slop Review

- Attack any stage that ships without its exit demo evidenced.
- Attack any new CLI surface that doesn't honor D135 §1-3 (output
  mode, envelope, structured errors).
- Attack any new dep that wasn't audited per D52 + D151 template.
- Attack a P5 demo claim that wasn't wall-clock-measured on a
  *physically* fresh machine. "Wiped node_modules" is not "fresh."
- Attack a `ductum init` flow that asks the operator more than the
  documented number of prompts per stage.
- Attack a `--json` mode that doesn't emit one envelope per
  meaningful progress event (so an orchestrator agent can drive
  install non-interactively).
- Attack any change to `scripts/bootstrap.mjs`. D150 keeps it as
  legacy; this arc does not touch it.
- Attack a publish (P4) without a fresh npm token. The 2026-05-03
  token disclosure must be treated as revoked before the operator
  publishes.

## Execution Order

| # | Prompt | Scope | Deliverable | Status | Depends On |
|---|---|---|---|---|---|
| 0 | [P0-DUCTUM-INIT-MVP.md](P0-DUCTUM-INIT-MVP.md) | cli/scripts | `ductum init` TUI skeleton; factory dir creation; `ductum.yaml` generation; **no logins yet** | [x] Shipped | — |
| 1 | [P1-ANTHROPIC-PKCE-LOGIN.md](P1-ANTHROPIC-PKCE-LOGIN.md) | cli | Reuse D132's PKCE flow inside TUI; subscription auth happens during `ductum init` | [x] Shipped | P0 |
| 2 | [P2-CODEX-COPILOT-LOGIN.md](P2-CODEX-COPILOT-LOGIN.md) | cli | Codex login + GitHub Copilot OAuth inside TUI; D130 detection extended to acquisition | [x] Shipped | P0, P1 |
| 3 | [P3-BROWSER-HANDOFF-WELCOME-ROUTE.md](P3-BROWSER-HANDOFF-WELCOME-ROUTE.md) | cli/dashboard | `--no-browser` opt-out; dashboard `/welcome` route walks "import your first spec" | [x] Shipped | P0 |
| 4 | [P4-PUBLISH-NPM-PACKAGE.md](P4-PUBLISH-NPM-PACKAGE.md) | scripts/release | `ductum@0.1.0` published to npm; first-publish provenance drift recorded in D157 | [x] Shipped | P0, P1, P2, P3 |
| 5 | [P5-RECOVERY-EXIT-DEMO-REDO.md](P5-RECOVERY-EXIT-DEMO-REDO.md) | demos | Fresh-machine wall-clock; closes D131's deferred exit | [ ] Harness implemented; operator demo pending | P0-P4 |

## Per-Stage Dispatch Strategy

| Stage | Strategy | Reason |
|-------|----------|--------|
| P0 | **codex direct** | Mechanical CLI scaffold + TUI integration. Contract is clear. Fast iteration on cosmetic UX. |
| P1 | **codex direct** | Port of D132's existing PKCE flow into the TUI shell. Codex wrote D132; same fingers, same area. |
| P2 | **codex direct** | OAuth flows are delicate (callback ports, scope strings). Codex direct beats dispatcher overhead while we're feeling out provider quirks. |
| P3 | **codex direct** | Browser-open + a single dashboard route. Mechanical. |
| P4 | **codex direct** | Publish is delicate; fresh agent attention beats a long dispatcher chain that risks publishing under stress. Operator pairs on the actual `npm publish` invocation. |
| P5 | **mixed** | The *demo runs personally* on a clean machine (only the operator can do that — fresh hardware, no creds). The *demo script and evidence harness* are codex direct. |

If at any point dogfooding "the factory ships its own redesign" becomes
the priority, swap individual stages to Ductum dispatch. Default is
operator-direct codex per the inventory rationale (faster, contract-
clear, this arc is mostly UX glue not novel runtime behavior).

## Dependencies Added by This Arc

Per D52 and D151. Pinned exactly, ≥7-day buffer satisfied at decision
time. Integrity hashes captured in D151.

| Package | Version | License | First seen | Purpose |
|---------|---------|---------|------------|---------|
| `@clack/prompts` | `1.2.0` | MIT | P0 | TUI prompt primitives (D148) |
| `@clack/core` | `1.2.0` | MIT | transitive | bundled with `@clack/prompts` |
| `open` | `11.0.0` | MIT | P3 | browser auto-open (D149) |

No other deps added. P1, P2 reuse existing PKCE / fetch / undici code.

## Cost Estimate

Per inventory: $20-40/stage cost ceiling on dispatched runs. Six
stages, default operator-direct codex, total arc target $150-250.
Spec hard cap: $250 to start; bump only with a recorded decision per
D120 conventions.

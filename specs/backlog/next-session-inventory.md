# Next-Session Inventory — what's left across the whole backlog

**Authored:** 2026-05-03 at the close of the operational hardening bundle thread.

**Audience:** any agent (or human) starting a fresh session against
`/Users/acartagena/project/ductum`. Read this first to know what's done,
what's left, and what's permanently deferred. Treat it as a snapshot, not
a contract — verify against the live repo before claiming any item.

## Verified state at handoff

- `main` HEAD = `3b1000c`, working tree clean, pushed to origin.
- 1593 package tests + 31 script tests passing.
- File-size gate green (681 files, 41 grandfathered per `decisions/112`).
- D109-D146 all on disk; recovery closed Outcome A (D131); operational
  hardening bundle closed (D135-D145); live SSE+cancel demo harness
  shipped (D146, `pnpm demos:sse-cancel`).

## Highest leverage — closes the biggest unproven claim

### 1. Bootstrap redesign arc

**Why first:** the recovery's wall-clock claim ("fresh clone → merged
commit < 10 min") was never timed end-to-end against real agents. D131
acknowledged the gap; subsequent bundles fixed adjacent issues but the
core flow is still unverified. This arc fixes that *and* turns Ductum
from "clone the repo, run scripts in place" into "install the tool,
run it from anywhere with no env vars."

**Six-stage shape, designed in user conversation 2026-05-03:**

1. **`ductum init` MVP** — TUI scaffold, factory dir creation, ductum.yaml
   generation, no logins yet (operator still pastes creds the old way for
   stage 1). Ships the TUI shell. Library bias: `clack` (MIT, modern, no
   native deps).
2. **Anthropic Claude PKCE login flow inside TUI** — port pi-mono PKCE
   pattern from `packages/ai/src/env-api-keys.ts` (the slice codex
   deferred in D132). Real subscription auth, no env vars.
3. **Codex login + GitHub Copilot OAuth in TUI** — multi-provider
   acquisition, not just detection (extends D130 detection to include
   acquisition).
4. **Browser handoff** — open dashboard at `/welcome` once factory is up;
   dashboard `/welcome` route walks through "import your first spec" flow.
5. **Publish as `ductum` npm package** — global install (`pnpm install -g
   ductum`), one tool managing many projects. The 1-day npm token from
   2026-05-03 conversation applies here.
6. **Recovery exit demo redo** — fresh clone (or `pnpm install -g
   ductum`) → `ductum init` → walk-through → first merged commit in
   under 10 min on a clean machine, with no env vars set. **This is the
   only honest definition of "factory ready" the recovery accepts.**

**Open design questions** (resolve before stage 1 dispatches):
- Global `pnpm install -g ductum` vs. project-local `pnpm install ductum`
  → leaning global (matches gh, vercel, stripe, pi CLIs)
- TUI library: clack vs. enquirer vs. inquirer → leaning clack
- Browser handoff: auto-open vs. print URL → leaning auto-open with
  `--no-browser` opt-out
- What happens to `scripts/bootstrap.mjs` during transition: keep as
  "developers-of-Ductum-itself" flow, or delete after new flow ships?
  → leaning keep, mark as legacy

**Target spec dir:** `specs/current/bootstrap-redesign/` — write
`README.md` + 6 P-files first, dispatch (or operator-direct codex) per
stage.

**Estimate:** 1-2 codex sessions per stage, $20-40 cost ceiling per
stage, total arc $150-250 + 6-12 codex sessions or 3-5 dispatched-agent
sessions.

## Medium leverage

### 2. D119 dashboard-as-operator-inbox implementing spec

**Why:** the decision exists; the implementing spec doesn't. The
dashboard is still mostly a passive data dump. After bootstrap-redesign
lands, the new `/welcome` route is the dashboard's first agent-shaped
surface — that's the natural moment to implement D119's broader vision.

**Bigger and design-heavy.** Probably wants its own dedicated session
sequence; not a single bundle.

### 3. D121 persistent-session-binding actual implementation

**Why:** the *decision* exists (D121); the implementation doesn't. The
operational hardening bundle's stale-slot GC (Feature 2 / D137) is a
band-aid that frees zombies on the next dispatcher cycle. Real reattach
— serve restart preserves live agent sessions — is still missing. Hit
the operator 3× in one session on 2026-04-30.

Per-harness: codex-sdk via app-server has session ids; claude-agent-sdk
session ids are reattachable in the SDK; for harnesses that can't
reattach, mark stalled with explicit reason rather than silently
orphaning.

### 4. Telegram fan-out (small follow-up bundle to D139)

**Why:** the SSE event stream from D139 ships; the Telegram one-way DM
consumer doesn't. ~50-100 LOC: a `ductum events --to telegram --bot
$TOKEN --chat $CHAT` CLI that pipes events from D139 to a Telegram chat.
Tiny scope, real "operator gets notified when run hits awaiting_approval"
value, no ngrok needed (D129's tap-approval round-trip stays deferred —
this is one-way notify only).

## Low leverage — incremental retrofit (pickable from `specs/backlog/agent-first-cli-output.yaml`)

In priority order; each is independently shippable in a single codex
session of 30-90 min.

### 5. Group A — output-mode retrofit on existing CLI/API

**Why:** biggest immediate UX win for orchestrator agents driving the
factory. The operational hardening bundle landed agent-first shape on
*new* commands only (per D135 §10 non-goals). Retrofitting existing
commands compounds across every agent interaction. ~8-12 commits,
mostly mechanical.

### 6. Group B — structured errors retrofit

**Why:** compounds the agent-first contract across every existing error
path. Without this, half the API still returns ad-hoc error strings
that orchestrator agents have to regex-parse. Codex's bundle showed the
value of `suggestedActions[].cmd`; retrofit makes it universal.

### 7. Group I — traceId on every envelope

**Why:** small (~100 LOC), high audit-trail value, near-zero risk. Lets
orchestrator agents correlate their actions with server-side logs by
capturing traceId on every response.

## Strategic but not urgent

### 8. Pre-dispatch critic layer

**Source:** brainstorm with user 2026-05-03 about "where codex is not
better than a senior dev" (design judgment, scope critique, anticipating
downstream issues, cross-cutting ergonomics).

**The shape:** a new spec lifecycle stage between `reviewed` and
`approved`. New task type `critique-<spec>` runs *before* impl tasks
unblock. Output is structured: top-3 questionable design choices, args
for+against each, proposed accept/reject decisions for the operator to
resolve. The spec doesn't transition `approved → implementing` until
all critique-issued decisions are explicitly resolved (and recorded in
the trail).

**Three commands cover the gaps:**
- `ductum spec critique <spec> [--mode design|scope]` — adversarial
  review of design choices and bundle scope
- `ductum spec impact <spec>` — forward-looking audit reading current
  spec + backlog + recent decisions, flags constraints the spec closes
  off
- `ductum spec lint <spec>` — registry of "things we keep forgetting"
  applied as a linter (when spec adds API envelope → ensure traceId;
  when spec touches dispatcher → check D121 reattach interactions; etc.)

**Why not urgent:** operator + codex direct + D135-style contracts is
working well enough today. The pre-dispatch critic layer becomes
valuable when the operator can't keep up with reviewing every bundle's
design themselves. Probably 3-6 months out.

**Bigger unlock available:** design-stage bakeoffs (multiple critic
agents on the same spec, blind reviewer picks the most rigorous
critique) would automate the senior-dev-design-review pattern. Same
machinery as impl bakeoffs (post-completion-router-route-blind-review),
applied to design artifacts instead of code.

### 9. Pause/resume runs

**Why:** depends on D121 (item 3). Ship persistent-session-binding
first, then pause/resume.

## Permanently deferred (not coming back)

- **D125 Pi unified harness as a runtime adapter** — D130's
  port-the-pattern approach absorbed the immediate value (multi-provider
  auth detection); the dependency-as-runtime version remains blocked by
  D52's seven supply-chain risks. If those resolve, revisit; otherwise
  Pi stays a pattern source, not a dependency.
- **D129 Telegram tap-approval round-trip** — needs ngrok or
  edictum-api relay; one-way notify (item 4) covers the practical case.
  Revisit only if mobile two-way approval becomes a hard requirement.

## Operator notes for the next session

1. **The 1-day npm token mentioned 2026-05-03 has expired.** The publish
   step in bootstrap-redesign stage 5 needs a fresh token at the time of
   publish; do not reuse the expired token from that session.

2. **Cumulative factory cost is ~$440 across 216+ runs** through
   2026-05-02. The recovery+bundles came in well under any individual
   spec cap (perSpecHardUsd was bumped to $300 in D120). Bootstrap
   redesign spec budget should start around $200 with room to bump.

3. **The factory dispatches its own work cleanly now.** Bootstrap
   redesign can be done either operator-direct codex (faster, like the
   bundles in this thread) or through Ductum dispatch (better dogfood
   evidence, slower). Pick based on whether you want to prove "the
   factory ships its own product redesign" or "we ship faster." No wrong
   answer.

4. **Operator-ship as a release valve still exists** — D135-D145 didn't
   change that. If a bootstrap-redesign review chain stalls or produces
   malformed verdicts, `ductum operator-ship <runId>` is the documented
   recovery path.

5. **Don't trust this file blindly.** Verify against the live repo
   before acting. The shape of the codebase moves; this file goes stale.

## Reference points

- D109 (recovery plan) → D131 (recovery closeout)
- D135 (agent-first design contract) → D136-D145 (operational hardening bundle) → D146 (live demo harness)
- `specs/backlog/agent-first-cli-output.yaml` — the agent-first retrofit groups A-I
- `specs/current/factory-readiness-recovery/README.md` — closed; archive only
- `~/.claude/projects/-Users-acartagena-project-ductum/memory/MEMORY.md` — Claude-specific session memory, contains pointers to sessions 2026-04-04 through 2026-05-03

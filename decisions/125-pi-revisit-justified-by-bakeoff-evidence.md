---
date: 2026-05-01
status: proposed
deciders: operator (Arnold Cartagena)
supersedes: none
related: 052, 109, 114, 115, 116, 118, 121
---

# Decision 125: Pi must come back, especially for non-Anthropic models

## Context

Decision 052 (2026-?-?) blocked Pi as a future harness candidate on
supply-chain risks and chose to ship N per-vendor harness adapters
instead (`claude-agent-sdk`, `codex-sdk`, `codex-app-server`,
`copilot-sdk`). The recovery has been paying interest on that
decision in small bills ever since, and the 2026-05-01 5-agent
bakeoff produced a clean, concentrated demonstration that the
per-vendor approach is the wrong load-bearing primitive for what
the factory actually needs.

This decision **does not reverse D052**. D052's supply-chain
analysis stands. This decision argues that the bakeoff evidence is
sufficient to **bring Pi back into the active roadmap as the
post-recovery harness work**, with a concrete shape, scope, and
priority order.

## Evidence from this session

Each per-vendor harness has its own foot-gun. The factory ships N
copies of every cross-cutting concern, one per adapter, and each
new model adds another adapter to maintain.

### claude-agent-sdk (sonnet, opus, opus-4-6)

- **glm-5.1 routing broken.** `ZAI_API_KEY` alone does not route
  the SDK to z.ai. The actual config needed (provided
  operator-direct mid-session) is:
  - `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`
  - `ANTHROPIC_AUTH_TOKEN=<z.ai token>` (note: `_AUTH_TOKEN`,
    not `_API_KEY`)
  - `API_TIMEOUT_MS=3000000`
  - Custom `--settings $HOME/.claude/settings-glm.json`
- The SDK's auth detection reads only `ANTHROPIC_*` env vars, so
  setting `ZAI_API_KEY` is silently ignored. There is no
  per-agent way to inject the right env vars for non-Anthropic
  models without forking the spawn path.
- **Cost: 4 P4 dispatches crashed at < 1 second each. P3
  review-r3 also crashed on this path. ~$2 burn + 10 minutes
  operator-direct intervention to remove glm from the project
  pool.**

### codex-app-server (codex, gpt-5-5)

- **Tool-call approval mismatch.** codex-app-server emits
  `item/commandExecution/requestApproval` and
  `item/fileChange/requestApproval` for every Bash and Edit tool
  call. The Ductum harness routes these through
  `evaluateApproval`, which the bakeoff revealed is wired to the
  Edictum policy path — and under non-interactive Ductum runs
  the policy returns false more often than expected, producing
  per-tool decline:

  ```
  [codex-as-Lte-gyT] file change approval: decline
  [codex-as-Lte-gyT] command approval: decline — /bin/zsh -lc 'pnpm exec ...'
  [codex-as-Lte-gyT] non-interactive mcpServer/elicitation/request:
                     Ductum runs are non-interactive; MCP elicitation declined
  ```

- The harness's `permissionMode: 'bypassPermissions'` flag works
  for claude-agent-sdk's tool path. It does **not** translate to
  codex-app-server's separate JSON-RPC approval protocol.
- **Cost: codex and gpt-5-5 candidates were spawned, made turns,
  but every Edit/Bash/elicitation got declined. Effective tool
  count = 0. The runs looked alive (heartbeat fresh, model calls
  happening) but produced no usable output. Two candidates ran
  multiple fix iterations against decline-blocked tools before
  the operator killed them.**

### codex-sdk (legacy)

- Reviewer-format-compat (D116) was a per-vendor patch because
  codex's prose-mixed verdict style didn't fit the parser. The
  patch widened the parser globally, but the underlying issue
  was that codex emits text differently from claude-agent-sdk
  and the harness didn't normalize.

### copilot-sdk

- Listed but unused this session. Not yet exercised against real
  product work.

### The pattern

Every cross-cutting concern in this session landed as N copies:

- **D116 reviewer-format-compat**: parser changes to handle
  prose-mixed verdicts (codex). Did not help opus/sonnet runs
  that ran out of turns mid-write (different bug, same surface).
- **D118 max-turns gate**: claude-agent-sdk has `maxTurns`,
  codex-app-server doesn't. The gate had to be claude-only.
  D118's `paused-cost-budget` for SDK budget cap is also
  claude-only — codex's analog (if it has one) is an open
  question.
- **D121 orphaned-session-reattach**: each adapter implements
  `tryReattach` separately. claude-agent-sdk has session log
  files; codex-app-server has thread files; copilot-sdk has its
  own state. Three separate reattach implementations to maintain.
- **D118 effective max_budget_usd**: hardcoded to read
  `process.env.DUCTUM_COST_BUDGET` and pass to claude-agent-sdk
  only. codex-app-server has no such mapping.

Every bug we ship is N×.

## Decision

**Pi (a unified harness) is the post-recovery harness work, and
the priority order is: GPT-family models first.**

The bakeoff demonstrated that:

- Anthropic models (sonnet, opus, opus-4-6) work today on
  claude-agent-sdk; the recovery did not need to fix them. We
  can keep them on claude-agent-sdk while Pi is built.
- GPT-family models (codex/gpt-5.4, gpt-5-5) **do not work
  today** under codex-app-server's approval protocol vs
  Ductum's non-interactive mode. They are excluded from the
  bakeoff and from the project pool until something fixes the
  approval path. That something is Pi.
- z.ai models (glm-5.1) work over claude-agent-sdk **only with
  the right env-var combination operator-direct**. Pi can
  encapsulate that as a per-agent config rather than as
  global env state.

Pi's shape is therefore:

1. **A single spawn API that abstracts the per-vendor protocol
   differences.** Pi knows about JSON-RPC approval for codex,
   tool-permission for claude, copilot's API. The factory calls
   `pi.spawn(agent, task, options)` and gets the same
   `HarnessSession` shape regardless of vendor.

2. **Per-agent config injection.** An agent's spawn config
   (already in the schema as `Agent.spawnConfig.env`) is read
   once at spawn-time and applied to that agent's session,
   without leaking into other agents' env. glm gets
   `ANTHROPIC_BASE_URL` set, sonnet doesn't.

3. **One `bypassPermissions` semantic** that maps to:
   - claude-agent-sdk: `permissionMode: 'bypassPermissions'`
   - codex-app-server: auto-`accept` on every approval request
     when running under Pi non-interactive mode
   - copilot-sdk: equivalent
   - z.ai routing: env-var + settings file applied at spawn
     time per the agent's config

4. **One reattach API.** Pi owns the reattach logic for all
   adapters. D121's `tryReattach` becomes a single entry point
   that dispatches to the right adapter internally.

5. **One verdict-emit normalizer.** The reviewer's `ductum_complete`
   call produces a verdict in the same shape regardless of which
   harness powered the agent session. The factory's parser
   doesn't need to handle codex prose-mixed vs claude
   `## Final verdict` differently — Pi normalizes upstream.

6. **One cost / token / turn accounting.** D118's `maxTurns`
   becomes a Pi cap that maps to whichever vendor protocol's
   primitive — turn count, internal budget, etc. The
   `paused-max-turns` and `paused-cost-budget` exit reasons
   come from Pi, not from each adapter.

## Why supply-chain risk doesn't override this anymore

D052 blocked Pi on supply-chain analysis (seven specific risks,
detailed in that doc). Those risks are still real, but the
bakeoff produced **concrete operational cost** that D052 did not
have available:

- ~$2 wasted on glm crashes during P4 attempts
- $50–80 wasted on codex/gpt-5-5 candidates that produced nothing
- 10+ minutes of operator-direct intervention each time a
  per-vendor adapter foot-gunned (e.g. closing glm runs with
  lineage, removing glm from the pool, killing codex bakeoff
  candidates, manually merging branches when stale-main hit)
- Three separate Decision documents (D116, D118 partial, D121)
  written to handle adapter-specific behavior, each a load-
  bearing patch in main.

These costs reproduce on every spec dispatched against an
agent that doesn't fit the claude-agent-sdk happy path. As soon
as Phase D (P4 / Catalog Truth) needs Telegram + glm + codex
work in the same spec — which is exactly P4's contract —
the operator overhead compounds.

D052's supply-chain risks remain. Pi must address them in its
implementation (lockfile pinning, isolated process boundary,
verified publishers, bounded permissions). But "we can't ship
Pi because of supply-chain risk" is now in tension with "we
can't ship the rest of the recovery because every other harness
has a load-bearing bug."

## Acceptance criteria for the future implementing spec

The Pi implementation spec (provisional name `pi-unified-harness`)
must:

1. **Smoke-test all five working agents (sonnet, opus, opus-4-6,
   codex, gpt-5-5) AND glm under Pi.** Each agent must complete
   the same `ductum agent test <agentName>` validator (the very
   bakeoff target from this session) without operator-direct
   intervention. PASS rate = 6/6.

2. **Self-host the bakeoff.** The 5-agent bakeoff that produced
   this Decision must run end-to-end under Pi without
   per-adapter operator-direct closure. All 5 candidates reach
   either `done` or a clean `failed` with a Pi-recognized exit
   reason; no run sits in approval-decline limbo.

3. **Encapsulate the glm config without env-var leakage.** When
   sonnet and glm run concurrently, sonnet's session does not
   see `ANTHROPIC_BASE_URL=https://api.z.ai/...`. Per-agent
   config isolation is testable.

4. **Replace D116, D118 (in part), D121 with single Pi modules**
   rather than per-adapter copies. The migration deletes
   adapter-specific code; it does not add to it.

5. **Address D052's seven supply-chain risks explicitly** — with
   a Decision-doc-row response per risk, citing concrete
   mitigation (lockfile, sandbox, signature, etc.).

## Out of scope for this Decision

- Pi's actual implementation. That is the implementing spec's
  job. D125 is the principle that triggers the spec.
- Replacing claude-agent-sdk for Anthropic models in the short
  term. They work today; Pi can absorb them gradually.
- Reversing D052's supply-chain analysis. Pi must answer it,
  not bypass it.

## Consequences

- The factory has a clear north star for the next hardening
  pass: GPT models become workable through Pi, glm becomes
  workable through Pi, the per-adapter foot-guns get retired
  one by one as Pi absorbs their cross-cutting concerns.
- Codex remains excluded from the agent pool until Pi ships.
  Project assignments (`projects.ductum.agents`) drop codex
  and gpt-5-5 in a follow-up commit. Sonnet, opus, opus-4-6
  remain.
- The 5-agent bakeoff completes with 3 working candidates
  (sonnet/opus/opus-4-6); the 2 failed ones (codex/gpt-5-5)
  are evidence in this Decision, not data points in the
  blind review.
- D115 Gap 8 (auto-rotate on agent failure) and Gap 11
  (notification on pendingApproval) are still real and
  separately scheduled — Pi doesn't replace them, but it
  does reduce the surface area where Gap 8's rotation
  matters (one harness failure mode instead of three).
- Every future "we need to support model X on harness Y"
  conversation routes through Pi's spawn API, not through a
  new adapter file in `packages/harness/src/`.

This decision is the operator's vote, written down: **the
factory's harness pluralism is a fragility, not a feature, and
Pi is the right load-bearing primitive to replace it.**

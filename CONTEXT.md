# Context — Why Ductum exists

## The trigger

On April 4, 2026, Anthropic announced that third-party harnesses (including OpenClaw) would no longer be covered by Claude subscription limits. This forced a re-evaluation of the AI factory architecture.

The key realization: the harness (OpenClaw) was not the valuable part. The orchestration — deciding what to build, in what order, with what enforcement — was always the bottleneck.

## The pain

Arnold runs a multi-agent AI factory with four agents (Mimi/Claude, Codex/GPT-5, GLM, and Claude for strategy). The planning pipeline works well — 8 phases from situational awareness through spec writing to implementation prompt generation.

But execution breaks every time:

- Agents finish local work and stop instead of pushing to PR/CI
- The human has to poll: "where are you on P2?" / "why no PR?"
- Agents are self-aware about the failure but not self-correcting
- Session crashes lose all state
- No visibility without asking
- No cost tracking
- No enforcement — CLAUDE.md instructions are advisory

Direct quote from the agent: "No blocker. Just the same pause failure on my side."

This is the GAP paper thesis (arXiv:2602.16943) in action: text-level alignment does not transfer to tool-call enforcement.

## The evidence

WhatsApp transcripts from Mimi sessions show the same pattern across every implementation prompt:

1. P2 local implementation done
2. Agent stops instead of pushing
3. Arnold asks "why no PR?"
4. Agent says "Because I split the work into two lanes and stopped at the local-complete gate again"
5. Arnold says "ok at least start it now"
6. Agent does it, works fine
7. P3: exact same failure

The problem is not capability — the agent knows what to do and does it correctly when told. The problem is enforcement — nothing structural prevents the agent from stopping.

## The solution

Ductum replaces the human-as-orchestrator with a system that:

- Models work as dependency graphs (specs → tasks → DAG)
- Assigns agents with roles and dispatches work automatically
- Enforces workflow stages via Edictum Workflow Gates (not advisory instructions)
- Persists all state in SQLite (survives crashes)
- Surfaces real-time visibility via dashboard (no polling)
- Records every decision for audit trail
- Tracks cost per agent, per task, per model

The enforcement is Edictum's job. When the agent finishes local tests and the
gate says "next required stage: push," the agent cannot stop. That's not an
instruction. It is a structural constraint evaluated locally through
`@edictum/core`, with edictum-api remaining optional audit/storage.

## The dogfood story

Ductum is built on Edictum. Every demo of Ductum is a demo of Edictum working in production. "This is how we built Edictum — using Edictum."

## Current subscriptions

| Service | Cost | Covers |
|---------|------|--------|
| Claude Max | 160 CHF/mo | Claude Code headless, Agent SDK, claude.ai |
| ChatGPT Pro | ~150 USD/mo (paid in BRL) | Codex CLI |
| GLM Coding Max | 300 USD/yr | GLM CLI |

All three agent harnesses support MCP.
